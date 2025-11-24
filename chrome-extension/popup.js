const form = document.getElementById('job-form');
const companyInput = document.getElementById('company');
const roleInput = document.getElementById('role');
const jobDescriptionInput = document.getElementById('jobDescription');
const statusSelect = document.getElementById('statusSelect');
const statusBanner = document.getElementById('status');
const openOptionsBtn = document.getElementById('openOptions');

let currentTabUrl = '';

const showStatus = (message, type = 'success') => {
  statusBanner.textContent = message;
  statusBanner.className = `status ${type}`;
  statusBanner.classList.remove('hidden');
};

const hideStatus = () => {
  statusBanner.className = 'status hidden';
  statusBanner.textContent = '';
};

const getSettings = async () => {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiBaseUrl', 'apiToken', 'supabaseUrl'], (items) => {
      resolve(items);
    });
  });
};

// Function to check if a JWT token is expired
const isTokenExpired = (token) => {
  if (!token) return true;
  
  try {
    // JWT tokens have 3 parts separated by dots: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    
    // Decode the payload (second part)
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    
    // Check if token has expiration claim
    if (payload.exp) {
      // exp is in seconds, Date.now() is in milliseconds
      const expirationTime = payload.exp * 1000;
      const now = Date.now();
      // Consider token expired if it expires within the next 60 seconds (buffer)
      return now >= (expirationTime - 60000);
    }
    
    // If no exp claim, assume it's valid (though this is unusual)
    return false;
  } catch (e) {
    // If we can't parse the token, consider it invalid
    return true;
  }
};

// Try to get token from the app's localStorage
// Searches all tabs to find the HireMe app and extract the token
// Also checks chrome.storage.sync first (which background.js keeps updated)
const tryGetTokenFromApp = async () => {
  try {
    const settings = await getSettings();
    
    // First, check if token is already stored (background.js keeps it updated)
    if (settings.apiToken) {
      // Check if stored token is expired
      if (isTokenExpired(settings.apiToken)) {
        console.log('Stored token is expired, clearing it');
        await chrome.storage.sync.set({ apiToken: null });
        // Continue to try to get a new token
      } else {
        return settings.apiToken;
      }
    }
    
    if (!settings.apiBaseUrl) return null;
    
    // Fallback: Try to find HireMe app tab by checking all tabs
    const tabs = await chrome.tabs.query({});
    const appBaseUrl = new URL(settings.apiBaseUrl).origin.replace(':4000', ''); // Remove port for matching
    
    // Find a tab that matches the app URL (could be localhost:5173 or your deployed URL)
    for (const tab of tabs) {
      if (!tab.url || !tab.id) continue;
      
      try {
        const tabUrl = new URL(tab.url);
        // Check if this tab is from the same origin as our app (localhost or same domain)
        const isAppTab = tabUrl.origin.includes('localhost') || 
                        tabUrl.origin.includes('127.0.0.1') ||
                        (appBaseUrl && tabUrl.origin.includes(new URL(appBaseUrl).hostname));
        
        if (isAppTab) {
          // Try to get token from this tab
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              try {
                // Comprehensive token search - check all Supabase-related keys
                const allKeys = Object.keys(localStorage);
                for (const key of allKeys) {
                  if (key.includes('supabase') || key.startsWith('sb-') || key.toLowerCase().includes('auth')) {
                    const data = localStorage.getItem(key);
                    if (data) {
                      try {
                        const parsed = JSON.parse(data);
                        // Check various possible structures
                        if (parsed?.access_token) return parsed.access_token;
                        if (parsed?.currentSession?.access_token) return parsed.currentSession.access_token;
                        if (parsed?.session?.access_token) return parsed.session.access_token;
                        if (parsed?.data?.access_token) return parsed.data.access_token;
                      } catch (e) {
                        // Check if it's a JWT token directly
                        if (data.startsWith('eyJ') && data.length > 100) {
                          return data;
                        }
                      }
                    }
                  }
                }
                
                // Also check sessionStorage
                const sessionKeys = Object.keys(sessionStorage);
                for (const key of sessionKeys) {
                  if (key.includes('supabase') || key.startsWith('sb-') || key.toLowerCase().includes('auth')) {
                    const data = sessionStorage.getItem(key);
                    if (data) {
                      try {
                        const parsed = JSON.parse(data);
                        if (parsed?.access_token) return parsed.access_token;
                        if (parsed?.currentSession?.access_token) return parsed.currentSession.access_token;
                        if (parsed?.session?.access_token) return parsed.session.access_token;
                        if (parsed?.data?.access_token) return parsed.data.access_token;
                      } catch (e) {
                        // Check if it's a JWT token directly
                        if (data.startsWith('eyJ') && data.length > 100) {
                          return data;
                        }
                      }
                    }
                  }
                }
              } catch (e) {
                // Error accessing localStorage (might be cross-origin)
              }
              return null;
            }
          });
          
          if (results?.[0]?.result) {
            const token = results[0].result;
            // Check if token is expired before storing
            if (isTokenExpired(token)) {
              console.log('Detected token is expired, not storing it');
              return null;
            }
            // Store it for future use
            await chrome.storage.sync.set({ apiToken: token });
            return token;
          }
        }
      } catch (e) {
        // Skip tabs we can't access
        continue;
      }
    }
  } catch (err) {
    // Silently fail - token not available
  }
  return null;
};

const populateFromPage = async () => {
  hideStatus();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showStatus('Unable to access active tab.', 'error');
      return;
    }
    currentTabUrl = tab.url || '';

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['contentScript.js']
    });

    if (result?.company) companyInput.value = result.company;
    if (result?.role) roleInput.value = result.role;
    if (result?.jobDescription) jobDescriptionInput.value = result.jobDescription;
  } catch (err) {
    console.error('Failed to scrape page:', err);
    showStatus('Unable to scrape this page. You can fill the fields manually.', 'error');
  }
};

const saveJob = async (settings) => {
  const company = companyInput.value.trim();
  const role = roleInput.value.trim();
  const jobDescription = jobDescriptionInput.value.trim();
  const status = statusSelect.value;
  const notes = document.getElementById('notes').value.trim();

  if (!company || !role) {
    showStatus('Company and role are required.', 'error');
    return;
  }

  if (!settings.apiBaseUrl) {
    showStatus('Please configure API Base URL in the extension options.', 'error');
    return;
  }

  // Try to get token automatically if not set or expired
  let apiToken = settings.apiToken;
  
  // Check if stored token is expired
  if (apiToken && isTokenExpired(apiToken)) {
    console.log('Stored token is expired, attempting to get a new one');
    await chrome.storage.sync.set({ apiToken: null });
    apiToken = null;
  }
  
  if (!apiToken) {
    // First try to get from background script (which may have just updated it)
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'refreshToken' }, resolve);
      });
      if (response?.token) {
        apiToken = response.token;
      }
    } catch (e) {
      console.log('Background script not available, trying direct detection');
    }
    
    // If still no token, try direct detection
    if (!apiToken) {
      apiToken = await tryGetTokenFromApp();
    }
    
    if (!apiToken) {
      showStatus('Token not found. Please make sure you are logged into the HireMe app in another tab, then try again.', 'error');
      return;
    }
  }

  showStatus('Saving job...', 'success');

  try {
    let res = await fetch(`${settings.apiBaseUrl.replace(/\/$/, '')}/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`
      },
      body: JSON.stringify({
        company,
        role,
        job_description: jobDescription,
        status,
        notes,
        source_url: currentTabUrl
      })
    });

    // If we get a 401, token might be expired - try to get a fresh token and retry
    if (res.status === 401) {
      console.log('Got 401, token may be expired. Attempting to get fresh token...');
      // Clear expired token
      await chrome.storage.sync.set({ apiToken: null });
      
      // Try to get a fresh token
      const freshToken = await tryGetTokenFromApp();
      if (freshToken) {
        // Retry with fresh token
        res = await fetch(`${settings.apiBaseUrl.replace(/\/$/, '')}/jobs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${freshToken}`
          },
          body: JSON.stringify({
            company,
            role,
            job_description: jobDescription,
            status,
            notes,
            source_url: currentTabUrl
          })
        });
      }
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(errorText || 'Failed to save job');
    }

    showStatus('Job saved to tracker! 🎉', 'success');
  } catch (err) {
    console.error('Failed to save job:', err);
    showStatus(err.message || 'Failed to save job.', 'error');
  }
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const settings = await getSettings();
  saveJob(settings);
});

openOptionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.addEventListener('DOMContentLoaded', async () => {
  await populateFromPage();
  
  // Always try to get a fresh token when popup opens
  const settings = await getSettings();
  if (settings.apiBaseUrl) {
    // Force token refresh by clearing stored token if expired
    if (settings.apiToken && isTokenExpired(settings.apiToken)) {
      await chrome.storage.sync.set({ apiToken: null });
    }
    
    // Try to get fresh token
    const token = await tryGetTokenFromApp();
    if (token) {
      // Token was found/updated
      console.log('Token automatically refreshed on popup open');
    } else {
      console.log('No token found - user may need to log in to HireMe app');
    }
  }
});

