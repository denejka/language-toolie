/**
 * background.js - Service Worker для обработки API запросов к OpenRouter
 * Обрабатывает проверку текста через нейросетевую модель
 */

// Константы для работы с OpenRouter API
const OPENROUTER_API_URL = 'https://openrouter.io/api/v1/chat/completions';
const FREE_MODELS = [
  'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-r1:free',
  'mistralai/mistral-7b-instruct:free',
  'qwen/qwen-2-7b-instruct:free'
];

// Слушаем сообщения от content-скрипта
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkText') {
    checkTextWithAI(request.text, request.genre)
      .then(corrections => sendResponse({ success: true, corrections }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Сообщаем Chrome, что ответ отправится асинхронно
  }

  if (request.action === 'getModels') {
    getAvailableModels()
      .then(models => sendResponse({ success: true, models }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'testConnection') {
    testOpenRouterConnection(request.apiKey)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

/**
 * Функция для проверки текста через OpenRouter API
 * @param {string} text - Текст для проверки
 * @param {string} genre - Жанр текста (Academic, General, Creative)
 * @returns {Promise<Array>} Массив исправлений
 */
async function checkTextWithAI(text, genre = 'General') {
  // Получаем сохраненные настройки
  const settings = await chrome.storage.sync.get(['apiKey', 'selectedModel', 'checkDepth', 'customPrompt']);
  
  if (!settings.apiKey) {
    throw new Error('API ключ не установлен. Пожалуйста, отрите настройки расширения.');
  }

  const model = settings.selectedModel || FREE_MODELS[0];
  const depth = settings.checkDepth || 2; // 1 = орфография, 2 = грамматика, 3 = полный анализ

  // Формируем промпт в зависимости от глубины проверки
  let depthInstruction = '';
  if (depth === 1) {
    depthInstruction = 'Проверь ТОЛЬКО орфографические ошибки.';
  } else if (depth === 2) {
    depthInstruction = 'Проверь орфографические и грамматические ошибки, пунктуацию.';
  } else {
    depthInstruction = 'Найди ВСЕ виды ошибок: орфография, пунктуация, грамматика, тавтология, нарушение логики, стилистически неверные обороты.';
  }

  const prompt = settings.customPrompt || getDefaultPrompt(depthInstruction, genre);

  try {
    // Отправляем запрос к OpenRouter API
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.apiKey}`,
        'HTTP-Reflex-Partition': 'free',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'Ты — эксперт-филолог и редактор. Отвечай ТОЛЬКО в формате JSON без лишнего текста.'
          },
          {
            role: 'user',
            content: prompt.replace('{{TEXT}}', text)
          }
        ],
        temperature: 0.3, // Низкая температура для большей консистентности
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('OpenRouter API ошибка:', error);
      throw new Error(`API ошибка: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    // Парсим JSON ответ (с fallback в случае ошибки)
    let corrections = [];
    try {
      // Пытаемся извлечь JSON от AI
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        corrections = parsed.corrections || [];
      } else {
        console.warn('JSON не найден в ответе AI');
      }
    } catch (e) {
      console.error('Ошибка парсинга JSON:', e);
      // Пытаемся еще раз с более строгим промптом
      return await checkTextWithAIRetry(text, settings.apiKey, model);
    }

    // Валидируем исправления
    corrections = corrections.filter(corr => 
      corr.start !== undefined && 
      corr.end !== undefined && 
      corr.wrong &&
      Array.isArray(corr.suggestions)
    );

    return corrections;
  } catch (error) {
    console.error('Ошибка проверки текста:', error);
    throw error;
  }
}

/**
 * Повторный запрос с более строгим промптом (fallback)
 */
async function checkTextWithAIRetry(text, apiKey, model) {
  const strictPrompt = `Проанализируй текст. Ответ ТОЛЬКО в этом формате JSON:
{"corrections": [{"start": 0, "end": 5, "wrong": "text", "suggestions": ["fix"], "reason": "rule"}]}`;

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [{
          role: 'user',
          content: strictPrompt + '\n\nТекст: ' + text
        }],
        temperature: 0.1,
        max_tokens: 2000
      })
    });

    if (!response.ok) throw new Error('Retry failed');
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.corrections || [];
    }
    
    return [];
  } catch (e) {
    console.error('Retry не удался:', e);
    return [];
  }
}

/**
 * Получение доступных бесплатных моделей
 */
async function getAvailableModels() {
  const settings = await chrome.storage.sync.get(['apiKey']);
  
  if (!settings.apiKey) {
    // Возвращаем локально сохраненный список, если нет API ключа
    return FREE_MODELS;
  }

  try {
    const response = await fetch('https://openrouter.io/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${settings.apiKey}`
      }
    });

    if (!response.ok) {
      return FREE_MODELS; // Fallback к локальному списку
    }

    const data = await response.json();
    
    // Фильтруем только бесплатные модели (содержат :free)
    const freeModels = data.data
      .filter(model => model.id.includes(':free') && !model.archived)
      .map(model => ({
        id: model.id,
        name: model.name || model.id,
        provider: model.id.split('/')[0]
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return freeModels.length > 0 ? freeModels : FREE_MODELS;
  } catch (error) {
    console.error('Ошибка при получении моделей:', error);
    return FREE_MODELS; // Fallback
  }
}

/**
 * Тестирование соединения с OpenRouter API
 */
async function testOpenRouterConnection(apiKey) {
  try {
    const response = await fetch('https://openrouter.io/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Неверный API ключ');
    }

    return true;
  } catch (error) {
    throw new Error(`Ошибка соединения: ${error.message}`);
  }
}

/**
 * Формирование стандартного промпта
 */
function getDefaultPrompt(depthInstruction, genre) {
  const contextMap = {
    'Academic': 'профессиональная/деловая переписка или эссе',
    'General': 'обычный текст',
    'Creative': 'творческий текст, художественное произведение'
  };

  const context = contextMap[genre] || contextMap['General'];

  return `Ты — эксперт-филолог и редактор. ${depthInstruction}
Контекст: ${context}.

Ответ должен быть ТОЛЬКО в формате JSON без лишнего текста:
{
  "corrections": [
    {
      "start": 10,
      "end": 15,
      "wrong": "текст с ошибкой",
      "suggestions": ["вариант исправления 1", "вариант 2"],
      "reason": "Краткое пояснение правила на русском языке"
    }
  ]
}

Текст для проверки: {{TEXT}}`;
}

// При установке расширения инициализируем настройки по умолчанию
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['apiKey', 'selectedModel', 'checkDepth'], (items) => {
    if (!items.apiKey) {
      chrome.storage.sync.set({
        selectedModel: FREE_MODELS[0],
        checkDepth: 2,
        language: 'ru',
        ignoreRules: [],
        whitelistSites: [],
        enabledSites: [],
        enabled: true
      });
    }
  });
  
  console.log('AI Grammar & Style Checker расширение установлено');
});
