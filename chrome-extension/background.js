// Background service worker to automatically detect and update API token
// Checks for token changes periodically and when tabs update

const TOKEN_CHECK_INTERVAL = 10000; // Check every 5 seconds for more responsive token detection
let tokenCheckInterval = null;

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

// Function to extract token from localStorage data
const extractTokenFromData = (data) => {
  if (!data) return null;
  
  try {
    // If data is already an object with access_token, use it directly
    if (typeof data === 'object' && data.access_token) {
      const token = data.access_token;
      if (isTokenExpired(token)) {
        console.log('[HireMe Extension] Token is expired, will not use it');
        return null;
      }
      return token;
    }
    
    // Try to parse as JSON if it's a string
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    let token = null;
    
    // Check various possible Supabase session structures
    if (parsed?.access_token) token = parsed.access_token;
    else if (parsed?.currentSession?.access_token) token = parsed.currentSession.access_token;
    else if (parsed?.session?.access_token) token = parsed.session.access_token;
    else if (parsed?.data?.access_token) token = parsed.data.access_token;
    
    // Check if token is expired
    if (token && isTokenExpired(token)) {
      console.log('[HireMe Extension] Token is expired, will not use it');
      return null;
    }
    
    return token;
  } catch (e) {
    // If it's already a token string, check it directly
    if (typeof data === 'string' && data.startsWith('eyJ')) {
      if (isTokenExpired(data)) {
        console.log('[HireMe Extension] Token string is expired');
        return null;
      }
      return data;
    }
  }
  return null;
};

// Function to get token from a specific tab
const getTokenFromTab = async (tabId) => {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          // Supabase stores tokens in localStorage with various key patterns
          // Common patterns: sb-<project>-auth-token, supabase.auth.token, etc.
          const allKeys = Object.keys(localStorage);
          
          // Try multiple patterns to find Supabase auth data
          for (const key of allKeys) {
            // Check for Supabase-related keys
            if (key.includes('supabase') || key.startsWith('sb-')) {
              const data = localStorage.getItem(key);
              if (data) {
                try {
                  const parsed = JSON.parse(data);
                  
                  // Check for direct access_token
                  if (parsed?.access_token) {
                    return { access_token: parsed.access_token, refresh_token: parsed.refresh_token };
                  }
                  
                  // Check nested structures
                  if (parsed?.currentSession?.access_token) {
                    return { 
                      access_token: parsed.currentSession.access_token,
                      refresh_token: parsed.currentSession.refresh_token 
                    };
                  }
                  
                  if (parsed?.session?.access_token) {
                    return { 
                      access_token: parsed.session.access_token,
                      refresh_token: parsed.session.refresh_token 
                    };
                  }
                  
                  // Check if it's a session object directly
                  if (parsed?.access_token && parsed?.token_type === 'bearer') {
                    return { 
                      access_token: parsed.access_token,
                      refresh_token: parsed.refresh_token 
                    };
                  }
                  
                  // Check for array of sessions
                  if (Array.isArray(parsed) && parsed.length > 0) {
                    const session = parsed[0];
                    if (session?.access_token) {
                      return { 
                        access_token: session.access_token,
                        refresh_token: session.refresh_token 
                      };
                    }
                  }
                } catch (e) {
                  // Not JSON or invalid, continue
                }
              }
            }
          }
          
          // Also check sessionStorage
          const sessionKeys = Object.keys(sessionStorage);
          for (const key of sessionKeys) {
            if (key.includes('supabase') || key.startsWith('sb-')) {
              const data = sessionStorage.getItem(key);
              if (data) {
                try {
                  const parsed = JSON.parse(data);
                  if (parsed?.access_token) {
                    return { 
                      access_token: parsed.access_token,
                      refresh_token: parsed.refresh_token 
                    };
                  }
                  if (parsed?.currentSession?.access_token) {
                    return { 
                      access_token: parsed.currentSession.access_token,
                      refresh_token: parsed.currentSession.refresh_token 
                    };
                  }
                  if (parsed?.session?.access_token) {
                    return { 
                      access_token: parsed.session.access_token,
                      refresh_token: parsed.session.refresh_token 
                    };
                  }
                } catch (e) {
                  // Not JSON, skip
                }
              }
            }
          }
          
          // Last resort: try to find any key that might contain a JWT token
          for (const key of allKeys) {
            if (key.toLowerCase().includes('token') || key.toLowerCase().includes('auth')) {
              const data = localStorage.getItem(key);
              if (data && data.length > 100) { // JWT tokens are usually long
                try {
                  const parsed = JSON.parse(data);
                  if (parsed?.access_token) {
                    return { 
                      access_token: parsed.access_token,
                      refresh_token: parsed.refresh_token 
                    };
                  }
                } catch (e) {
                  // Check if it's a JWT token directly (starts with eyJ)
                  if (data.startsWith('eyJ')) {
                    return { access_token: data };
                  }
                }
              }
            }
          }
        } catch (e) {
          console.error('Error in token extraction:', e);
        }
        return null;
      }
    });
    
    if (results?.[0]?.result) {
      const result = results[0].result;
      if (result?.access_token) {
        return extractTokenFromData(result);
      }
    }
  } catch (e) {
    console.error('[HireMe Extension] Error getting token from tab:', e);
  }
  return null;
};

// Function to find HireMe app tabs and extract token
const findAndUpdateToken = async () => {
  try {
    const settings = await new Promise((resolve) => {
      chrome.storage.sync.get(['apiBaseUrl', 'apiToken'], resolve);
    });
    
    if (!settings.apiBaseUrl) {
      // No API base URL configured, can't determine which tabs to check
      return;
    }

    // Check if current stored token is expired
    if (settings.apiToken && isTokenExpired(settings.apiToken)) {
      console.log('[HireMe Extension] Stored token is expired, clearing it');
      await new Promise((resolve) => {
        chrome.storage.sync.set({ apiToken: null }, resolve);
      });
    }

    const appBaseUrl = new URL(settings.apiBaseUrl).origin.replace(':4000', '');
    const tabs = await chrome.tabs.query({});
    
    // Find tabs that match the HireMe app
    for (const tab of tabs) {
      if (!tab.url || !tab.id) continue;
      
      try {
        const tabUrl = new URL(tab.url);
        // Check if this tab is from the same origin as our app
        const isAppTab = tabUrl.origin.includes('localhost') || 
                        tabUrl.origin.includes('127.0.0.1') ||
                        (appBaseUrl && tabUrl.origin.includes(new URL(appBaseUrl).hostname));
        
        if (isAppTab) {
          const token = await getTokenFromTab(tab.id);
          if (token) {
            // Always update if we got a valid token (even if same, in case it was refreshed)
            await new Promise((resolve) => {
              chrome.storage.sync.set({ apiToken: token }, resolve);
            });
            if (token !== settings.apiToken) {
              console.log('[HireMe Extension] Token automatically updated');
            }
          } else if (settings.apiToken && isTokenExpired(settings.apiToken)) {
            // Token is expired and we couldn't get a new one, clear it
            await new Promise((resolve) => {
              chrome.storage.sync.set({ apiToken: null }, resolve);
            });
            console.log('[HireMe Extension] Expired token cleared');
          }
        }
      } catch (e) {
        // Skip tabs we can't access
        continue;
      }
    }
  } catch (err) {
    // Silently fail - token check failed
    console.error('[HireMe Extension] Token check error:', err);
  }
};

// Start periodic token checking
const startTokenChecking = () => {
  if (tokenCheckInterval) {
    clearInterval(tokenCheckInterval);
  }
  
  // Check immediately
  findAndUpdateToken();
  
  // Then check periodically
  tokenCheckInterval = setInterval(findAndUpdateToken, TOKEN_CHECK_INTERVAL);
};

// Stop token checking
const stopTokenChecking = () => {
  if (tokenCheckInterval) {
    clearInterval(tokenCheckInterval);
    tokenCheckInterval = null;
  }
};

// Listen for tab updates (when user navigates or refreshes)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Tab finished loading, check if it's a HireMe app tab
    chrome.storage.sync.get(['apiBaseUrl'], (items) => {
      if (!items.apiBaseUrl) return;
      
      try {
        const tabUrl = new URL(tab.url);
        const appBaseUrl = new URL(items.apiBaseUrl).origin.replace(':4000', '');
        const isAppTab = tabUrl.origin.includes('localhost') || 
                        tabUrl.origin.includes('127.0.0.1') ||
                        (appBaseUrl && tabUrl.origin.includes(new URL(appBaseUrl).hostname));
        
        if (isAppTab) {
          // Small delay to ensure localStorage is updated
          setTimeout(() => {
            getTokenFromTab(tabId).then((token) => {
              if (token) {
                chrome.storage.sync.set({ apiToken: token });
                console.log('[HireMe Extension] Token updated from tab navigation');
              } else {
                // If we couldn't get a token, check if stored token is expired and clear it
                chrome.storage.sync.get(['apiToken'], (items) => {
                  if (items.apiToken && isTokenExpired(items.apiToken)) {
                    chrome.storage.sync.set({ apiToken: null }, () => {
                      console.log('[HireMe Extension] Expired token cleared after tab navigation');
                    });
                  }
                });
              }
            });
          }, 1000);
        }
      } catch (e) {
        // Skip invalid URLs
      }
    });
  }
});

// Listen for messages from popup or other parts of extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getToken') {
    // Immediately try to find and return token
    findAndUpdateToken().then(() => {
      chrome.storage.sync.get(['apiToken'], (items) => {
        sendResponse({ token: items.apiToken || null });
      });
    });
    return true; // Indicates we will send a response asynchronously
  }
  
  if (request.action === 'refreshToken') {
    // Force refresh token
    findAndUpdateToken().then(() => {
      chrome.storage.sync.get(['apiToken'], (items) => {
        sendResponse({ token: items.apiToken || null });
      });
    });
    return true;
  }
});

// Start checking when service worker starts
startTokenChecking();

// Also check immediately on startup
setTimeout(() => {
  findAndUpdateToken();
}, 1000); // Small delay to ensure storage is ready

// Clean up on shutdown
chrome.runtime.onSuspend.addListener(() => {
  stopTokenChecking();
});

