const form = document.getElementById('options-form');
const apiBaseUrlInput = document.getElementById('apiBaseUrl');
const apiTokenInput = document.getElementById('apiToken');
const statusBanner = document.getElementById('options-status');

const showStatus = (message, type = 'success') => {
  statusBanner.textContent = message;
  statusBanner.className = `status ${type}`;
  statusBanner.classList.remove('hidden');
  setTimeout(() => {
    statusBanner.className = 'status hidden';
  }, 4000);
};

const loadSettings = () => {
  chrome.storage.sync.get(['apiBaseUrl', 'apiToken'], (items) => {
    if (items.apiBaseUrl) apiBaseUrlInput.value = items.apiBaseUrl;
    if (items.apiToken) apiTokenInput.value = items.apiToken;
  });
};

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const apiBaseUrl = apiBaseUrlInput.value.trim();
  const apiToken = apiTokenInput.value.trim();

  if (!apiBaseUrl) {
    showStatus('API Base URL is required.', 'error');
    return;
  }

  // API Token is optional - extension will try to auto-detect it
  chrome.storage.sync.set({ 
    apiBaseUrl, 
    apiToken: apiToken || null 
  }, () => {
    showStatus('Settings saved!', 'success');
  });
});

document.addEventListener('DOMContentLoaded', loadSettings);

