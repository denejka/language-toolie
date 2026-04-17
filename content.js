/**
 * content.js - Content Script для отслеживания текстовых полей и отрисовки ошибок
 * Сканирует input, textarea и contenteditable элементы
 */

// Состояние расширения
let extensionEnabled = true;
let currentCorrections = new Map(); // Хранит исправления для каждого поля
let debounceTimers = new Map(); // Таймеры для дебауса
let selectedFieldId = null; // ID текущего проверяемого поля
let floatingPopup = null; // Текущее всплывающее окно

// Загружаем настройки при загрузке скрипта
chrome.storage.sync.get(['enabled', 'enabledSites', 'whitelistSites'], (settings) => {
  extensionEnabled = settings.enabled !== false;
  
  // Проверяем, не находимся ли на исключенном сайте
  const currentDomain = window.location.hostname;
  if (settings.whitelistSites && settings.whitelistSites.includes(currentDomain)) {
    extensionEnabled = false;
  }
});

// Слушаем изменения настроек в реальном времени
chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) {
    extensionEnabled = changes.enabled.newValue;
  }
});

/**
 * Инициализация - поиск и подготовка всех текстовых полей
 */
function initializeTextFields() {
  if (!extensionEnabled) return;

  // Находим все input и textarea элементы
  const fields = document.querySelectorAll('input[type="text"], textarea, [contenteditable="true"]');
  
  fields.forEach((field, index) => {
    // Пропускаем уже инициализированные поля
    if (field.dataset.grammarCheckerId) {
      return;
    }

    // Присваиваем уникальный ID каждому полю
    field.dataset.grammarCheckerId = `field-${index}-${Date.now()}`;
    
    // Добавляем слушатели событий
    field.addEventListener('input', (e) => handleFieldInput(e));
    field.addEventListener('focus', (e) => handleFieldFocus(e));
    field.addEventListener('blur', (e) => handleFieldBlur(e));
    field.addEventListener('click', (e) => handleFieldClick(e));

    // Создаем контейнер для отрисовки ошибок
    createErrorOverlay(field);
  });
}

/**
 * Обработка ввода в текстовое поле (с дебаунсом)
 */
function handleFieldInput(event) {
  const field = event.target;
  const fieldId = field.dataset.grammarCheckerId;
  
  // Очищаем предыдущий таймер
  if (debounceTimers.has(fieldId)) {
    clearTimeout(debounceTimers.get(fieldId));
  }

  // Устанавливаем новый таймер (500-800 ms)
  const timer = setTimeout(() => {
    const text = getFieldText(field);
    
    // Проверяем минимальную длину текста для отправки
    if (text.trim().length > 3) {
      checkText(text, field);
    } else {
      // Очищаем ошибки для короткого текста
      clearErrorsForField(field);
    }
  }, 600);

  debounceTimers.set(fieldId, timer);
}

/**
 * Обработка фокуса на поле
 */
function handleFieldFocus(event) {
  selectedFieldId = event.target.dataset.grammarCheckerId;
  
  // Показываем существующие ошибки, если они есть
  const field = event.target;
  if (currentCorrections.has(selectedFieldId)) {
    showErrorHighlight(field);
  }
}

/**
 * Обработка потери фокуса
 */
function handleFieldBlur(event) {
  selectedFieldId = null;
  closeFloatingPopup();
}

/**
 * Обработка клика на поле для открытия всплывающего окна
 */
function handleFieldClick(event) {
  const field = event.target;
  
  // Определяем позицию клика в тексте
  if (field.tagName === 'DIV' && field.contentEditable === 'true') {
    // Для contenteditable элемента
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(field);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      const cursorPos = preCaretRange.toString().length;
      
      checkClickPosition(field, cursorPos, event);
    }
  } else {
    // Для input и textarea
    const cursorPos = field.selectionStart || 0;
    checkClickPosition(field, cursorPos, event);
  }
}

/**
 * Проверка позиции клика для определения ошибки
 */
function checkClickPosition(field, cursorPos, mouseEvent) {
  const fieldId = field.dataset.grammarCheckerId;
  const corrections = currentCorrections.get(fieldId) || [];
  
  // Ищем ошибку в позиции клика
  const error = corrections.find(corr => 
    corr.start <= cursorPos && cursorPos <= corr.end
  );

  if (error) {
    showFloatingPopup(field, error, mouseEvent.clientX, mouseEvent.clientY);
  } else {
    closeFloatingPopup();
  }
}

/**
 * Получение текста из поля (для всех типов полей)
 */
function getFieldText(field) {
  if (field.tagName === 'DIV' && field.contentEditable === 'true') {
    return field.textContent || '';
  }
  return field.value || '';
}

/**
 * Установка текста в поле
 */
function setFieldText(field, text) {
  if (field.tagName === 'DIV' && field.contentEditable === 'true') {
    field.textContent = text;
  } else {
    field.value = text;
  }
  
  // Триггерим событие input для обновления
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Отправка текста на проверку
 */
async function checkText(text, field) {
  const fieldId = field.dataset.grammarCheckerId;
  
  // Показываем индикатор загрузки
  showLoadingIndicator(field);

  try {
    // Отправляем сообщение в Service Worker
    chrome.runtime.sendMessage(
      { action: 'checkText', text: text, genre: 'General' },
      (response) => {
        if (response.success) {
          currentCorrections.set(fieldId, response.corrections);
          showErrorHighlight(field);
        } else {
          console.error('Ошибка проверки:', response.error);
          showErrorNotification(field, response.error);
        }
        hideLoadingIndicator(field);
      }
    );
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    hideLoadingIndicator(field);
  }
}

/**
 * Отрисовка ошибок в виде волнистого подчеркивания
 */
function showErrorHighlight(field) {
  const fieldId = field.dataset.grammarCheckerId;
  const corrections = currentCorrections.get(fieldId) || [];
  
  if (corrections.length === 0) {
    return;
  }

  // Удаляем старое выделение
  const overlay = field.parentElement.querySelector('.grammar-error-overlay');
  if (overlay) {
    overlay.innerHTML = '';
  }

  const text = getFieldText(field);
  
  // Для обычных input/textarea используем абсолютный overlay
  if (field.tagName !== 'DIV') {
    drawErrorLines(field, corrections, text);
  } else {
    // Для contenteditable используем inline decoration
    decorateContenteditable(field, corrections, text);
  }
}

/**
 * Рисование линий ошибок для input/textarea
 */
function drawErrorLines(field, corrections, text) {
  const overlay = field.parentElement.querySelector('.grammar-error-overlay');
  if (!overlay) return;

  const canvas = overlay.querySelector('canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Получаем стили поля для расчета позиций
  const style = window.getComputedStyle(field);
  const lineHeight = parseInt(style.lineHeight);
  const charWidth = getCharWidth(field);

  corrections.forEach(correction => {
    if (correction.type === 'logic') {
      // Желтый пунктир для логических ошибок
      drawDashedUnderline(ctx, correction.start, correction.end, text, '#FFC107', charWidth, lineHeight);
    } else {
      // Красная волнистая линия для других ошибок
      drawWavyUnderline(ctx, correction.start, correction.end, text, charWidth, lineHeight);
    }
  });
}

/**
 * Получение ширины одного символа
 */
function getCharWidth(element) {
  const testSpan = document.createElement('span');
  testSpan.textContent = 'M';
  testSpan.style.visibility = 'hidden';
  testSpan.style.position = 'absolute';
  testSpan.style.font = window.getComputedStyle(element).font;
  
  document.body.appendChild(testSpan);
  const width = testSpan.offsetWidth;
  document.body.removeChild(testSpan);
  
  return width;
}

/**
 * Рисование волнистой линии
 */
function drawWavyUnderline(ctx, start, end, text, charWidth, lineHeight) {
  const x = start * charWidth;
  const y = lineHeight - 3;
  const width = (end - start) * charWidth;

  ctx.strokeStyle = '#EF5350'; // Красный
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Рисуем волнистую линию
  ctx.beginPath();
  for (let i = 0; i < width; i += 4) {
    const waveY = y + (i % 8 < 4 ? 2 : -2);
    if (i === 0) {
      ctx.moveTo(x, waveY);
    } else {
      ctx.lineTo(x + i, waveY);
    }
  }
  ctx.stroke();
}

/**
 * Рисование пунктирной линии для логических ошибок
 */
function drawDashedUnderline(ctx, start, end, text, color, charWidth, lineHeight) {
  const x = start * charWidth;
  const y = lineHeight - 2;
  const width = (end - start) * charWidth;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Декорирование contenteditable элемента
 */
function decorateContenteditable(field, corrections, text) {
  // Сохраняем текущую позицию курсора
  const selection = window.getSelection();
  let cursorOffset = 0;
  
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(field);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    cursorOffset = preCaretRange.toString().length;
  }

  // Перестраиваем содержимое с подчеркиванием
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  corrections.forEach(correction => {
    if (correction.start > lastIndex) {
      const textNode = document.createTextNode(text.substring(lastIndex, correction.start));
      fragment.appendChild(textNode);
    }

    const span = document.createElement('span');
    span.textContent = text.substring(correction.start, correction.end);
    span.style.textDecoration = correction.type === 'logic' ? 'underline wavy #FFC107' : 'underline wavy #EF5350';
    span.style.cursor = 'pointer';
    span.title = correction.reason || 'Ошибка';
    span.dataset.correctionIndex = corrections.indexOf(correction);
    
    span.addEventListener('click', (e) => {
      showFloatingPopup(field, correction, e.clientX, e.clientY);
    });

    fragment.appendChild(span);
    lastIndex = correction.end;
  });

  if (lastIndex < text.length) {
    const textNode = document.createTextNode(text.substring(lastIndex));
    fragment.appendChild(textNode);
  }

  field.innerHTML = '';
  field.appendChild(fragment);

  // Восстанавливаем позицию курсора
  // (Сложная операция для contenteditable, может потребоваться упрощение)
}

/**
 * Создание overlay контейнера для ошибок
 */
function createErrorOverlay(field) {
  if (field.tagName === 'DIV') {
    return; // Для contenteditable используем inline декорирование
  }

  // Проверяем, уже ли создан overlay
  if (field.parentElement.querySelector('.grammar-error-overlay')) {
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'grammar-error-overlay';
  overlay.style.position = 'absolute';
  overlay.style.top = field.offsetTop + 'px';
  overlay.style.left = field.offsetLeft + 'px';
  overlay.style.width = field.offsetWidth + 'px';
  overlay.style.height = field.offsetHeight + 'px';
  overlay.style.pointerEvents = 'none';
  overlay.style.overflow = 'hidden';

  const canvas = document.createElement('canvas');
  canvas.width = field.offsetWidth;
  canvas.height = field.offsetHeight;
  overlay.appendChild(canvas);

  field.parentElement.style.position = 'relative';
  field.parentElement.insertBefore(overlay, field.nextSibling);
}

/**
 * Показание всплывающего окна с вариантами исправления
 */
function showFloatingPopup(field, correction, x, y) {
  closeFloatingPopup();

  const popup = document.createElement('div');
  popup.className = 'grammar-floating-popup';
  popup.style.position = 'fixed';
  popup.style.left = x + 'px';
  popup.style.top = (y + 20) + 'px';
  popup.style.zIndex = '10000';

  popup.innerHTML = `
    <div class="popup-header">
      <span class="error-title">Ошибка: ${correction.wrong}</span>
    </div>
    <div class="popup-reason">${correction.reason}</div>
    <div class="popup-suggestions">
      ${correction.suggestions.map((suggestion, index) => `
        <button class="suggestion-btn" data-index="${index}">
          ${suggestion}
        </button>
      `).join('')}
    </div>
    <div class="popup-actions">
      <button class="action-btn fix-one">Исправить это</button>
      <button class="action-btn fix-all">Исправить всё</button>
    </div>
  `;

  document.body.appendChild(popup);
  floatingPopup = popup;

  // Добавляем обработчики событий
  popup.querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index);
      applyCorrection(field, correction, correction.suggestions[index]);
      closeFloatingPopup();
    });
  });

  popup.querySelector('.fix-one').addEventListener('click', () => {
    applyCorrection(field, correction, correction.suggestions[0]);
    closeFloatingPopup();
  });

  popup.querySelector('.fix-all').addEventListener('click', () => {
    applyAllCorrections(field);
    closeFloatingPopup();
  });

  // Закрытие при клике снаружи
  document.addEventListener('click', (e) => {
    if (!popup.contains(e.target) && e.target !== field) {
      closeFloatingPopup();
    }
  }, { once: true });
}

/**
 * Применение одного исправления
 */
function applyCorrection(field, correction, suggestion) {
  const text = getFieldText(field);
  const newText = text.substring(0, correction.start) + suggestion + text.substring(correction.end);
  
  setFieldText(field, newText);

  // Очищаем кэш исправлений для этого поля
  const fieldId = field.dataset.grammarCheckerId;
  currentCorrections.delete(fieldId);
}

/**
 * Применение всех исправлений
 */
function applyAllCorrections(field) {
  const fieldId = field.dataset.grammarCheckerId;
  const corrections = currentCorrections.get(fieldId) || [];
  
  if (corrections.length === 0) return;

  let text = getFieldText(field);
  
  // Сортируем исправления в обратном порядке, чтобы индексы оставались валидными
  const sortedCorrections = [...corrections].sort((a, b) => b.start - a.start);
  
  sortedCorrections.forEach(correction => {
    const suggestion = correction.suggestions[0] || '';
    text = text.substring(0, correction.start) + suggestion + text.substring(correction.end);
  });

  setFieldText(field, text);
  currentCorrections.delete(fieldId);
}

/**
 * Закрытие всплывающего окна
 */
function closeFloatingPopup() {
  if (floatingPopup) {
    floatingPopup.remove();
    floatingPopup = null;
  }
}

/**
 * Очистка ошибок для поля
 */
function clearErrorsForField(field) {
  const fieldId = field.dataset.grammarCheckerId;
  currentCorrections.delete(fieldId);
  
  const overlay = field.parentElement.querySelector('.grammar-error-overlay');
  if (overlay) {
    const canvas = overlay.querySelector('canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
}

/**
 * Показание индикатора загрузки
 */
function showLoadingIndicator(field) {
  let indicator = field.parentElement.querySelector('.grammar-loading-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'grammar-loading-indicator';
    indicator.style.position = 'absolute';
    indicator.style.right = '8px';
    indicator.style.top = '50%';
    indicator.style.transform = 'translateY(-50%)';
    indicator.style.width = '20px';
    indicator.style.height = '20px';
    indicator.innerHTML = '<div class="spinner"></div>';
    
    field.parentElement.style.position = 'relative';
    field.parentElement.appendChild(indicator);
  }
  
  indicator.style.display = 'block';
}

/**
 * Скрытие индикатора загрузки
 */
function hideLoadingIndicator(field) {
  const indicator = field.parentElement.querySelector('.grammar-loading-indicator');
  if (indicator) {
    indicator.style.display = 'none';
  }
}

/**
 * Показание уведомления об ошибке
 */
function showErrorNotification(field, errorMessage) {
  const notification = document.createElement('div');
  notification.className = 'grammar-error-notification';
  notification.textContent = `Ошибка: ${errorMessage}`;
  notification.style.position = 'fixed';
  notification.style.top = '20px';
  notification.style.right = '20px';
  notification.style.zIndex = '10001';
  notification.style.padding = '15px 20px';
  notification.style.backgroundColor = '#EF5350';
  notification.style.color = 'white';
  notification.style.borderRadius = '8px';
  notification.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
  
  document.body.appendChild(notification);
  
  // Удаляем уведомление через 5 секунд
  setTimeout(() => {
    notification.remove();
  }, 5000);
}

// Инициализация при загрузке страницы
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeTextFields);
} else {
  initializeTextFields();
}

// Переинициализация при добавлении новых элементов (для динамических сайтов)
const observer = new MutationObserver((mutations) => {
  let shouldReinit = false;
  
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      // Проверяем, были ли добавлены текстовые поля
      const addedNodes = mutation.addedNodes;
      for (const node of addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches && (node.matches('input[type="text"], textarea, [contenteditable="true"]') ||
              node.querySelector('input[type="text"], textarea, [contenteditable="true"]'))) {
            shouldReinit = true;
            break;
          }
        }
      }
    }
    if (shouldReinit) break;
  }
  
  if (shouldReinit) {
    initializeTextFields();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
