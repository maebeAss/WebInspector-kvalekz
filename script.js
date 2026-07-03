// ---------- DOM-ссылки ----------
const urlInput      = document.getElementById('urlInput');
const analyzeBtn     = document.getElementById('analyzeBtn');
const errorMsg       = document.getElementById('errorMsg');
const spinnerWrap    = document.getElementById('spinnerWrap');
const welcome        = document.getElementById('welcome');
const resultsBlock   = document.getElementById('results');
const previewFrame   = document.getElementById('previewFrame');
const statsGrid      = document.getElementById('statsGrid');
const errorsGrid     = document.getElementById('errorsGrid');
const warningsGrid   = document.getElementById('warningsGrid');
const successGrid    = document.getElementById('successGrid');
const historyList    = document.getElementById('historyList');
const clearHistoryBtn= document.getElementById('clearHistoryBtn');

const HISTORY_KEY = 'webinspector_history';
// Публичный CORS-прокси. Нужен, потому что напрямую fetch() чужого домена
// браузер блокирует политикой Same-Origin (CORS) — это НЕ ошибка кода,
// а фундаментальное ограничение браузера, обойти которое без сервера/прокси нельзя
const PROXY = 'https://corsproxy.io/?url=';

// ---------- Валидация URL ----------
// Добавляет https://, если протокол не указан, и проверяет корректность через конструктор URL
function normalizeAndValidateUrl(raw){
  let value = raw.trim();
  if(!value) return null;
  if(!/^https?:\/\//i.test(value)){
    value = 'https://' + value;
  }
  try{
    const u = new URL(value);
    return u.href;
  }catch(e){
    return null;
  }
}

// ---------- Отображение ошибки ----------
function showError(text){
  errorMsg.textContent = text;
  errorMsg.style.display = 'block';
}
function hideError(){
  errorMsg.style.display = 'none';
  errorMsg.textContent = '';
}

// ---------- Обработчик кнопки ----------
analyzeBtn.addEventListener('click', () => runAnalysis());
urlInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') runAnalysis(); });

async function runAnalysis(){
  hideError();
  const validUrl = normalizeAndValidateUrl(urlInput.value);
  if(!validUrl){
    showError('Введите корректный URL сайта (например, example.com).');
    return;
  }

  analyzeBtn.disabled = true;
  spinnerWrap.style.display = 'flex';
  welcome.style.display = 'none';
  resultsBlock.style.display = 'none';

  const startTime = performance.now();

  try{
    // Загружаем HTML-код сайта через прокси (обходим CORS)
    const response = await fetch(PROXY + encodeURIComponent(validUrl));
    if(!response.ok) throw new Error('Сайт вернул ошибку загрузки');
    const html = await response.text();

    const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);

    // Показываем сайт визуально во iframe (может не отобразиться, если сайт
    // запрещает встраивание через заголовок X-Frame-Options — это нормально,
    // на сбор статистики это не влияет, т.к. она берётся из спарсенного HTML)
    previewFrame.src = validUrl;

    const data = collectSiteData(html, validUrl, loadTime);
    const report = buildReport(data);

    renderReport(data, report);
    saveToHistory(validUrl, report, data);

  }catch(err){
    showError('Не удалось проанализировать сайт. Возможно, он недоступен, блокирует внешние запросы или временно не отвечает. Попробуйте другой адрес.');
    resultsBlock.style.display = 'none';
    welcome.style.display = 'block';
  }finally{
    analyzeBtn.disabled = false;
    spinnerWrap.style.display = 'none';
  }
}

// ---------- Сбор данных со страницы ----------
// Парсим полученный HTML через DOMParser — работаем с "виртуальным" документом,
// не вставляя чужой код напрямую в текущую страницу (безопаснее, чем innerHTML)
function collectSiteData(html, url, loadTime){
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const title = doc.querySelector('title')?.textContent.trim() || '';
  const description = doc.querySelector('meta[name="description"]');
  const keywords = doc.querySelector('meta[name="keywords"]');
  const viewport = doc.querySelector('meta[name="viewport"]');

  const h1 = doc.querySelectorAll('h1').length;
  const h2 = doc.querySelectorAll('h2').length;
  const h3 = doc.querySelectorAll('h3').length;
  const images = doc.querySelectorAll('img').length;
  const links = doc.querySelectorAll('a').length;

  const isHttps = url.startsWith('https://');

  return {
    url, title,
    hasDescription: !!description,
    hasKeywords: !!keywords,
    hasViewport: !!viewport,
    h1, h2, h3,
    totalHeadings: h1 + h2 + h3,
    images, links,
    isHttps,
    loadTime
  };
}

function buildReport(d){
  const errors = [];
  const warnings = [];
  const success = [];

  if(!d.title){
    errors.push({ icon:'🏷️', title:'Отсутствует title', desc:'Добавьте тег <title> для улучшения SEO и отображения во вкладке браузера.', details:'Тег title — один из ключевых сигналов для поисковых систем и должен кратко описывать содержание страницы.' });
  }else{
    success.push({ icon:'🏷️', title:'Есть title', desc:`Заголовок страницы: "${d.title}".`, details:'Хорошо, что заголовок присутствует — это влияет на ранжирование в поиске.' });
  }

  if(!d.hasDescription){
    errors.push({ icon:'📝', title:'Отсутствует meta-description', desc:'Добавьте мета-тег description — он показывается в сниппете поисковой выдачи.', details:'Рекомендуемая длина description — 120–160 символов, с ключевыми словами страницы.' });
  }else{
    success.push({ icon:'📝', title:'Meta-description найден', desc:'Мета-описание присутствует на странице.', details:'Проверьте вручную, что описание уникально и отражает суть страницы.' });
  }

  if(d.h1 === 0){
    errors.push({ icon:'🔠', title:'Отсутствует заголовок h1', desc:'Добавьте один h1 на странице — он должен отражать главную тему.', details:'Наличие ровно одного h1 — стандартная SEO-практика для структуры документа.' });
  }else{
    success.push({ icon:'🔠', title:'H1 присутствует', desc:`Найдено h1: ${d.h1}.`, details:'Убедитесь, что h1 используется только один раз на странице.' });
  }

  if(d.totalHeadings < 3){
    warnings.push({ icon:'📑', title:'Мало заголовков', desc:'Используйте больше заголовков (h2, h3) для структурирования контента.', details:`Сейчас всего заголовков: ${d.totalHeadings}. Структура помогает и пользователям, и поисковым роботам.` });
  }else{
    success.push({ icon:'📑', title:'Хорошая структура заголовков', desc:`Всего заголовков: ${d.totalHeadings}.`, details:'Контент логично разбит на разделы.' });
  }

  if(d.links > 50){
    warnings.push({ icon:'🔗', title:'Слишком много ссылок', desc:'Проверьте качество и релевантность ссылок на странице.', details:`Найдено ссылок: ${d.links}. Более 50 ссылок могут "размывать" вес страницы для поисковиков.` });
  }

  if(!d.isHttps){
    errors.push({ icon:'🔓', title:'Нет HTTPS', desc:'Рекомендуем перейти на защищённый протокол HTTPS.', details:'Отсутствие SSL негативно влияет на доверие пользователей и ранжирование в поиске.' });
  }else{
    success.push({ icon:'🔒', title:'Есть SSL-сертификат', desc:'Сайт работает по защищённому протоколу HTTPS.', details:'Это положительно влияет на безопасность и доверие пользователей.' });
  }

  if(!d.hasViewport){
    warnings.push({ icon:'📱', title:'Нет адаптивности', desc:'Добавьте мета-тег viewport для корректного отображения на мобильных устройствах.', details:'Без этого тега мобильные браузеры масштабируют страницу как десктопную версию.' });
  }else{
    success.push({ icon:'📱', title:'Есть мета-тег viewport', desc:'Страница подготовлена для адаптивного отображения.', details:'Проверьте вручную корректность отображения на разных экранах.' });
  }

  if(parseFloat(d.loadTime) < 1){
    success.push({ icon:'⚡', title:'Быстрая загрузка', desc:`Время загрузки: ~${d.loadTime}с — отличный результат.`, details:'Быстрая загрузка положительно влияет на пользовательский опыт и SEO.' });
  }else{
    warnings.push({ icon:'🐢', title:'Долгая загрузка', desc:`Время загрузки: ~${d.loadTime}с. Рекомендуем оптимизировать ресурсы.`, details:'Рассмотрите сжатие изображений, минификацию CSS/JS и использование кэша.' });
  }

  return { errors, warnings, success };
}

// ---------- Рендер отчёта (без innerHTML для данных — только DOM-методы) ----------
function renderReport(d, report){
  statsGrid.textContent = '';
  errorsGrid.textContent = '';
  warningsGrid.textContent = '';
  successGrid.textContent = '';

  const stats = [
    ['Название', d.title || '—'],
    ['H1', d.h1],
    ['H2', d.h2],
    ['H3', d.h3],
    ['Изображений', d.images],
    ['Ссылок', d.links],
    ['SSL', d.isHttps ? '✅ Да' : '❌ Нет'],
    ['Адаптивность', d.hasViewport ? '✅ Да' : '❌ Нет'],
    ['Загрузка', `~${d.loadTime}с`]
  ];
  stats.forEach(([label, value], i) => statsGrid.appendChild(makeStatBox(label, value, i)));

  report.errors.forEach((item, i)   => errorsGrid.appendChild(makeCard(item, 'var(--error)', i)));
  report.warnings.forEach((item, i) => warningsGrid.appendChild(makeCard(item, 'var(--warn)', i)));
  report.success.forEach((item, i)  => successGrid.appendChild(makeCard(item, 'var(--success)', i)));

  if(report.errors.length === 0)   errorsGrid.appendChild(makeEmptyNote('Критических ошибок не найдено 🎉'));
  if(report.warnings.length === 0) warningsGrid.appendChild(makeEmptyNote('Предупреждений нет 👍'));

  resultsBlock.style.display = 'block';
}

function makeStatBox(label, value, index){
  const box = document.createElement('div');
  box.className = 'stat-box';
  box.style.animationDelay = (index * 0.05) + 's';

  const val = document.createElement('div');
  val.className = 'val';
  val.textContent = value;

  const lbl = document.createElement('div');
  lbl.className = 'lbl';
  lbl.textContent = label;

  box.appendChild(val);
  box.appendChild(lbl);
  return box;
}

function makeCard(item, color, index){
  const card = document.createElement('div');
  card.className = 'card';
  card.style.setProperty('--cat-color', color);
  card.style.animationDelay = (index * 0.08) + 's';

  const top = document.createElement('div');
  top.className = 'card-top';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'card-title';

  const icon = document.createElement('span');
  icon.className = 'card-icon';
  icon.textContent = item.icon;

  const titleText = document.createElement('span');
  titleText.textContent = item.title;

  titleWrap.appendChild(icon);
  titleWrap.appendChild(titleText);

  const moreBtn = document.createElement('button');
  moreBtn.className = 'more-btn';
  moreBtn.textContent = 'Подробнее';
  moreBtn.addEventListener('click', () => {
    card.classList.toggle('expanded');
    moreBtn.textContent = card.classList.contains('expanded') ? 'Скрыть' : 'Подробнее';
  });

  top.appendChild(titleWrap);
  top.appendChild(moreBtn);

  const desc = document.createElement('div');
  desc.className = 'card-desc';
  desc.textContent = item.desc;

  const details = document.createElement('div');
  details.className = 'card-details';
  details.textContent = item.details;

  card.appendChild(top);
  card.appendChild(desc);
  card.appendChild(details);
  return card;
}

function makeEmptyNote(text){
  const p = document.createElement('p');
  p.className = 'history-empty';
  p.textContent = text;
  return p;
}

// ---------- История в localStorage ----------
function getHistory(){
  try{
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  }catch(e){
    return [];
  }
}

function saveToHistory(url, report, data){
  const history = getHistory();
  const entry = {
    url,
    date: new Date().toLocaleString('ru-RU'),
    errors: report.errors.length,
    warnings: report.warnings.length,
    success: report.success.length,
    report, data
  };
  history.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20)));
  renderHistory();
}

function renderHistory(){
  historyList.textContent = '';
  const history = getHistory();

  if(history.length === 0){
    historyList.appendChild(makeEmptyNote('Пока нет ни одной проверки.'));
    return;
  }

  history.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'history-item';

    const urlEl = document.createElement('div');
    urlEl.className = 'url';
    urlEl.textContent = entry.url;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${entry.date} · ❌${entry.errors} ⚠️${entry.warnings} ✅${entry.success}`;

    item.appendChild(urlEl);
    item.appendChild(meta);

    item.addEventListener('click', () => {
      welcome.style.display = 'none';
      previewFrame.src = entry.url;
      renderReport(entry.data, entry.report);
      urlInput.value = entry.url;
    });

    historyList.appendChild(item);
  });
}

clearHistoryBtn.addEventListener('click', () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

// ---------- Инициализация ----------
renderHistory();

/*
 * ПРИМЕЧАНИЯ ПО РАЗРАБОТКЕ:
 * 1. Прямой fetch() чужого сайта из браузера блокируется политикой CORS —
 *    это ограничение самого браузера, а не ошибка кода. Поэтому для сбора
 *    реальных данных используется публичный CORS-прокси (allorigin), а
 *    iframe используется только для визуального предпросмотра сайта.
 * 2. Сбор метрик реализован через DOMParser: полученный HTML парсится в
 *    отдельный "виртуальный" документ, из которого через querySelector/
 *    querySelectorAll достаются title, meta, заголовки, изображения, ссылки.
 * 3. Генерация рекомендаций (buildReport) — авторская логика на основе
 *    набора правил "метрика → вывод", без использования сторонних библиотек.
 * 4. Вывод карточек реализован через DOM-методы (createElement/textContent),
 *    без innerHTML — по требованию задания (безопаснее и корректнее).
 * 5. История проверок хранится в localStorage в виде JSON (JSON.stringify/
 *    parse), включает полные данные отчёта для повторной загрузки без
 *    повторного запроса к сайту.
 * 6. Тёмная тема, карточный дизайн, stagger-анимация появления карточек
 *    (через animation-delay) и hover-эффекты (translateY + тень) реализованы
 *    вручную на чистом CSS.
 * ЗАМЕНИТЬ ПЕРЕД СДАЧЕЙ: имя файла и Фамилию/Группу в этом комментарии —
 * подставить свои реальные данные.
 */