/**
 * popup.js - Логика всплывающего меню расширения из тулбара
 */

// Элементы
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const fieldsCount = document.getElementById('fields-count');
const errorsCount = document.getElementById('errors-count');
const currentModel = document.getElementById('current-model');
const currentDepth = document.getElementById('current-depth');
const toggleExtensionBtn = document.getElementById('toggle-extension');
const clearCacheBtn = document.getElementById('clear-cache');
const openSettingsBtn = document.getElementById('open-settings');
const openHelpBtn = document.getElementById('open-help');

let extensionEnabled = true;

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  attachEventListeners();
  updateStats();
});

/**
 * Загрузка настроек из chrome.storage
 */
async function loadSettings() {
  const settings = await chrome.storage.sync.get([
    'enabled',
    'selectedModel',
    'checkDepth'
  ]);

  extensionEnabled = settings.enabled !== false;
  
  // Обновляем UI
  updateStatusDisplay();
  
  // Отображаем текущую модель
  const modelId = settings.selectedModel || 'google/gemini-2.0-flash-exp:free';
  const modelNames = {
    'google/gemini-2.0-flash-exp:free': 'Google Gemini 2.0',
    'meta-llama/llama-3.3-70b-instruct:free': 'Llama 3.3 70B',
    'deepseek/deepseek-r1:free': 'DeepSeek R1',
    'mistralai/mistral-7b-instruct:free': 'Mistral 7B',
    'qwen/qwen-2-7b-instruct:free': 'Qwen 2 7B'
  };
  
  currentModel.textContent = modelNames[modelId] || modelId;

  // Отображаем уровень глубины
  const depth = settings.checkDepth || 2;
  const depthNames = {
    1: 'Орфография',
    2: 'Стандартная',
    3: 'Полный анализ'
  };
  currentDepth.textContent = depthNames[depth] || 'Неизвестно';
}

/**
 * Обновление отображения статуса
 */
function updateStatusDisplay() {
  if (extensionEnabled) {
    statusIndicator.classList.add('active');
    statusIndicator.classList.remove('inactive');
    statusText.textContent = 'Активно';
    toggleExtensionBtn.classList.add('active');
    toggleExtensionBtn.textContent = '✓ Включить';
  } else {
    statusIndicator.classList.add('inactive');
    statusIndicator.classList.remove('active');
    statusText.textContent = 'Отключено';
    toggleExtensionBtn.classList.remove('active');
    toggleExtensionBtn.textContent = '✗ Отключить';
  }
}

/**
 * Обновление статистики
 */
async function updateStats() {
  // Получаем активный таб
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab) return;

  // Отправляем запрос на content-скрипт для получения статистики
  try {
    chrome.tabs.sendMessage(tab.id, { action: 'getStats' }, (response) => {
      if (response && response.fieldsCount !== undefined) {
        fieldsCount.textContent = response.fieldsCount;
        errorsCount.textContent = response.errorsCount;
      }
    });
  } catch (error) {
    // Content-скрипт не всегда доступен
    console.log('Content script не ответил');
  }
}

/**
 * Привязка обработчиков событий
 */
function attachEventListeners() {
  toggleExtensionBtn.addEventListener('click', toggleExtension);
  clearCacheBtn.addEventListener('click', clearCache);
  openSettingsBtn.addEventListener('click', openSettings);
  openHelpBtn.addEventListener('click', openHelp);
}

/**
 * Переключение включения/отключения расширения
 */
async function toggleExtension() {
  extensionEnabled = !extensionEnabled;
  
  await chrome.storage.sync.set({ enabled: extensionEnabled });
  updateStatusDisplay();

  // Отправляем уведомление content-скриптам
  const tabs = await chrome.tabs.query({});
  tabs.forEach(tab => {
    try {
      chrome.tabs.sendMessage(tab.id, {
        action: 'updateEnabled',
        enabled: extensionEnabled
      });
    } catch (error) {
      // Игнорируем ошибки для вкладок без content-скрипта
    }
  });

  showNotification(extensionEnabled ? 'Расширение включено' : 'Расширение отключено');
}

/**
 * Очистка кэша
 */
async function clearCache() {
  // Очищаем локальное хранилище кэша
  await chrome.storage.local.set({
    lastCheckResults: {},
    cachedCorrections: {}
  });

  // Отправляем сообщение контент-скриптам для очистки
  const tabs = await chrome.tabs.query({});
  tabs.forEach(tab => {
    try {
      chrome.tabs.sendMessage(tab.id, { action: 'clearErrorCache' });
    } catch (error) {
      // Игнорируем ошибки
    }
  });

  showNotification('✓ Кэш очищен');
}

/**
 * Открытие страницы настроек
 */
function openSettings() {
  chrome.runtime.openOptionsPage();
  window.close();
}

/**
 * Открытие справки
 */
function openHelp() {
  const helpText = `
    AI Grammar & Style Checker v1.0.0
    
    Горячие клавиши:
    • Проверка включена по умолчанию
    • Нажмите иконку расширения, чтобы открыть меню
    
    Режимы проверки:
    1️⃣ Орфография - только опечатки
    2️⃣ Стандартная - грамматика и пунктуация
    3️⃣ Полный анализ - все ошибки + логика
    
    Советы:
    • Сохраняйте настройки в раздел "Настройки"
    • Добавляйте домены в исключения для отключения на сайтах
    • Используйте пользовательский промпт для специализированных проверок
  `;

  alert(helpText);
}

/**
 * Показание уведомления
 */
function showNotification(message) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #6200EE 0%, #00D084 100%);
    color: white;
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 12px;
    z-index: 10000;
    animation: slideDown 0.3s ease-out;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  `;
  
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideUp 0.3s ease-out forwards';
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

// Добавляем CSS анимации
const style = document.createElement('style');
style.textContent = `
  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
  
  @keyframes slideUp {
    to {
      opacity: 0;
      transform: translateX(-50%) translateY(-20px);
    }
  }
`;
document.head.appendChild(style);

console.log('Popup script loaded');
