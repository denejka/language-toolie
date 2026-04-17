/**
 * options.js - Логика страницы настроек расширения
 */

// Elements
const apiKeyInput = document.getElementById('api-key');
const toggleApiVisibility = document.getElementById('toggle-api-visibility');
const testConnectionBtn = document.getElementById('test-connection');
const connectionMessage = document.getElementById('connection-message');
const modelSelect = document.getElementById('model-select');
const refreshModelsBtn = document.getElementById('refresh-models');
const modelInfo = document.getElementById('model-info');
const modelDescription = document.getElementById('model-description');

const checkDepthSlider = document.getElementById('check-depth');
const depthLabel = document.getElementById('depth-label');
const interfaceLanguage = document.getElementById('interface-language');
const textGenre = document.getElementById('text-genre');
const customPromptTextarea = document.getElementById('custom-prompt');

const extensionEnabledToggle = document.getElementById('extension-enabled');
const whitelistSites = document.getElementById('whitelist-sites');
const ignoreRules = document.querySelectorAll('.ignore-rule');
const resetSettingsBtn = document.getElementById('reset-settings');

const tabButtons = document.querySelectorAll('.tab-button');
const tabPanes = document.querySelectorAll('.tab-pane');

const advancedToggle = document.getElementById('advanced-toggle');
const advancedContent = document.getElementById('advanced-content');

// Константы моделей
const MODEL_DESCRIPTIONS = {
  'google/gemini-2.0-flash-exp:free': {
    name: 'Google Gemini 2.0 Flash',
    provider: 'Google',
    description: 'Быстрая многомодальная модель. Отличное качество для грамматики и стиля.'
  },
  'meta-llama/llama-3.3-70b-instruct:free': {
    name: 'Llama 3.3 70B',
    provider: 'Meta',
    description: 'Мощная открытая модель. Хорошо справляется с логическими ошибками.'
  },
  'deepseek/deepseek-r1:free': {
    name: 'DeepSeek R1',
    provider: 'DeepSeek',
    description: 'Модель с глубоким анализом. Высокая точность, но медленнее.'
  },
  'mistralai/mistral-7b-instruct:free': {
    name: 'Mistral 7B',
    provider: 'Mistral AI',
    description: 'Компактная и быстрая модель. Хорошо справляется с орфографией.'
  },
  'qwen/qwen-2-7b-instruct:free': {
    name: 'Qwen 2 7B',
    provider: 'Alibaba',
    description: 'Легкая многоязычная модель. Хороша для быстрых проверок.'
  }
};

// ==================== Инициализация ====================

document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
  attachEventListeners();
  await loadAvailableModels();
});

// ==================== Управление вкладками ====================

function attachEventListeners() {
  // Переключение вкладок
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      switchTab(tabName);
    });
  });

  // API Key
  apiKeyInput.addEventListener('change', saveSettings);
  toggleApiVisibility.addEventListener('click', toggleApiKeyVisibility);

  // Проверка соединения
  testConnectionBtn.addEventListener('click', testConnection);

  // Модели
  modelSelect.addEventListener('change', saveSettings);
  refreshModelsBtn.addEventListener('click', loadAvailableModels);

  // Глубина проверки
  checkDepthSlider.addEventListener('input', updateDepthLabel);
  checkDepthSlider.addEventListener('change', saveSettings);

  // Прочие настройки
  interfaceLanguage.addEventListener('change', saveSettings);
  textGenre.addEventListener('change', saveSettings);
  customPromptTextarea.addEventListener('change', saveSettings);
  extensionEnabledToggle.addEventListener('change', saveSettings);
  whitelistSites.addEventListener('change', saveSettings);

  // Исключаемые правила
  ignoreRules.forEach(rule => {
    rule.addEventListener('change', saveSettings);
  });

  // Сброс настроек
  resetSettingsBtn.addEventListener('click', resetSettings);

  // Расширенные параметры
  advancedToggle.addEventListener('click', toggleAdvanced);
}

function switchTab(tabName) {
  // Деактивируем все вкладки
  tabButtons.forEach(btn => btn.classList.remove('active'));
  tabPanes.forEach(pane => pane.classList.remove('active'));

  // Активируем выбранную вкладку
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(tabName).classList.add('active');
}

// ==================== Загрузка и сохранение настроек ====================

async function loadSettings() {
  const settings = await chrome.storage.sync.get([
    'apiKey',
    'selectedModel',
    'checkDepth',
    'language',
    'textGenre',
    'customPrompt',
    'enabled',
    'whitelistSites',
    'ignoreRules'
  ]);

  // Заполняем поля
  if (settings.apiKey) {
    apiKeyInput.value = settings.apiKey;
  }

  modelSelect.value = settings.selectedModel || 'google/gemini-2.0-flash-exp:free';

  checkDepthSlider.value = settings.checkDepth || 2;
  updateDepthLabel();

  interfaceLanguage.value = settings.language || 'ru';
  textGenre.value = settings.textGenre || 'General';
  customPromptTextarea.value = settings.customPrompt || '';

  extensionEnabledToggle.checked = settings.enabled !== false;

  whitelistSites.value = (settings.whitelistSites || []).join('\n');

  if (settings.ignoreRules) {
    ignoreRules.forEach(rule => {
      rule.checked = settings.ignoreRules.includes(rule.value);
    });
  }

  // Обновляем версию
  const manifest = chrome.runtime.getManifest();
  document.getElementById('extension-version').textContent = manifest.version;
}

function saveSettings() {
  const whitelistArray = whitelistSites.value
    .split('\n')
    .map(domain => domain.trim())
    .filter(domain => domain.length > 0);

  const ignoreRulesArray = Array.from(ignoreRules)
    .filter(rule => rule.checked)
    .map(rule => rule.value);

  chrome.storage.sync.set({
    apiKey: apiKeyInput.value,
    selectedModel: modelSelect.value,
    checkDepth: parseInt(checkDepthSlider.value),
    language: interfaceLanguage.value,
    textGenre: textGenre.value,
    customPrompt: customPromptTextarea.value,
    enabled: extensionEnabledToggle.checked,
    whitelistSites: whitelistArray,
    ignoreRules: ignoreRulesArray
  });

  showNotification('✓ Настройки сохранены', 'success');
}

// ==================== API Key Управление ====================

function toggleApiKeyVisibility() {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  toggleApiVisibility.textContent = isPassword ? '🙈' : '👁️';
}

async function testConnection() {
  const apiKey = apiKeyInput.value.trim();
  
  if (!apiKey) {
    showNotification('⚠ Введите API Key', 'error');
    return;
  }

  testConnectionBtn.disabled = true;
  testConnectionBtn.classList.add('loading');
  connectionMessage.textContent = 'Проверка соединения...';
  connectionMessage.className = 'connection-message loading';

  try {
    await chrome.runtime.sendMessage(
      { action: 'testConnection', apiKey: apiKey },
      (response) => {
        if (response && response.success) {
          connectionMessage.textContent = '✓ Соединение успешно';
          connectionMessage.className = 'connection-message success';
          showNotification('✓ Соединение успешно установлено', 'success');
        } else {
          const error = response?.error || 'Неизвестная ошибка';
          connectionMessage.textContent = `✗ Ошибка: ${error}`;
          connectionMessage.className = 'connection-message error';
          showNotification(`✗ Ошибка: ${error}`, 'error');
        }
      }
    );
  } catch (error) {
    connectionMessage.textContent = `✗ Ошибка: ${error.message}`;
    connectionMessage.className = 'connection-message error';
    showNotification(`✗ Ошибка: ${error.message}`, 'error');
  } finally {
    testConnectionBtn.disabled = false;
    testConnectionBtn.classList.remove('loading');
  }
}

// ==================== Управление моделями ====================

async function loadAvailableModels() {
  refreshModelsBtn.disabled = true;
  refreshModelsBtn.style.animation = 'spin 2s linear infinite';

  try {
    await chrome.runtime.sendMessage(
      { action: 'getModels' },
      (response) => {
        if (response && response.success) {
          populateModelSelect(response.models);
          showNotification('✓ Список моделей обновлен', 'success');
        } else {
          console.error('Ошибка загрузки моделей:', response?.error);
          populateModelSelect(getDefaultModels());
        }
      }
    );
  } catch (error) {
    console.error('Ошибка при запросе моделей:', error);
    populateModelSelect(getDefaultModels());
  } finally {
    refreshModelsBtn.disabled = false;
    refreshModelsBtn.style.animation = 'none';
  }
}

function populateModelSelect(models) {
  const currentValue = modelSelect.value;
  modelSelect.innerHTML = '';

  // Преобразуем массив моделей в нужный формат
  const modelArray = Array.isArray(models) ? models : 
    models.map(name => ({ id: name, name: name }));

  modelArray.forEach(model => {
    const option = document.createElement('option');
    option.value = model.id || model;
    const displayName = MODEL_DESCRIPTIONS[model.id]?.name || model.name || model;
    option.textContent = displayName;
    modelSelect.appendChild(option);
  });

  // Восстанавливаем выбор
  modelSelect.value = currentValue;
  
  // Обновляем описание
  updateModelDescription();
  modelSelect.addEventListener('change', updateModelDescription);
}

function updateModelDescription() {
  const selectedModelId = modelSelect.value;
  const description = MODEL_DESCRIPTIONS[selectedModelId];

  if (description) {
    modelDescription.innerHTML = `
      <strong>${description.name}</strong> (${description.provider})<br>
      ${description.description}
    `;
  } else {
    modelDescription.textContent = 'Информация о модели не доступна';
  }

  saveSettings();
}

function getDefaultModels() {
  return Object.keys(MODEL_DESCRIPTIONS);
}

// ==================== Параметры проверки ====================

function updateDepthLabel() {
  const depth = parseInt(checkDepthSlider.value);
  const labels = {
    1: '(Только орфография)',
    2: '(Стандартная)',
    3: '(Полный анализ)'
  };
  depthLabel.textContent = labels[depth];
}

// ==================== Расширенные параметры ====================

function toggleAdvanced() {
  advancedContent.style.display = 
    advancedContent.style.display === 'none' ? 'block' : 'none';
  
  const arrow = advancedToggle.querySelector('.collapse-icon');
  arrow.style.transform = 
    advancedContent.style.display === 'none' ? 'rotate(0deg)' : 'rotate(90deg)';
}

// ==================== Сброс и уведомления ====================

function resetSettings() {
  if (confirm('Вы уверены? Все настройки будут сброшены на значения по умолчанию.')) {
    chrome.storage.sync.clear(() => {
      chrome.storage.sync.set({
        selectedModel: 'google/gemini-2.0-flash-exp:free',
        checkDepth: 2,
        language: 'ru',
        textGenre: 'General',
        customPrompt: '',
        enabled: true,
        whitelistSites: [],
        ignoreRules: [],
        enabledSites: [],
        minTextLength: 4,
        debounceDelay: 600,
        maxTextLength: 4000
      });
      
      loadSettings();
      showNotification('✓ Все настройки сброшены', 'success');
    });
  }
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;

  if (type === 'success') {
    notification.style.backgroundColor = '#4CAF50';
    notification.style.color = 'white';
  } else if (type === 'error') {
    notification.style.backgroundColor = '#EF5350';
    notification.style.color = 'white';
  } else {
    notification.style.backgroundColor = '#2196F3';
    notification.style.color = 'white';
  }

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Анимация CSS
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;
document.head.appendChild(style);

// Инициализация при загрузке
console.log('Options page loaded');
