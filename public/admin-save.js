(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AdminSave = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  async function request(url, options, { timeoutMs = 30000, fetcher = globalThis.fetch } = {}) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('The server took too long to confirm the save. Your entries are still here. Check the property list before saving again; the request may have reached the server.');
        error.code = 'SAVE_TIMEOUT';
        reject(error);
        controller.abort();
      }, timeoutMs);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await fetcher(url, { ...options, signal: controller.signal });
        let result;
        try { result = await response.json(); }
        catch { throw new Error('The server returned an unreadable response. Your entries are still here. Check the property list before saving again.'); }
        if (response.status === 401) throw new Error('Your admin session has expired. Sign in again in another tab, then return here to save your entries.');
        if (!response.ok || !result?.success) throw new Error(result?.message || 'The property could not be saved. Your entries are still here.');
        return result;
      })()]);
    } finally { clearTimeout(timer); }
  }
  return { request };
});
