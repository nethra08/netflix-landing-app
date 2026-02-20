/**
 * Auth utilities - shared across login and register pages
 * Handles session checks and common auth logic
 */

// Add credentials to fetch for session cookies
const authFetch = (url, options = {}) => {
  return fetch(url, {
    ...options,
    credentials: 'include',
  });
};
