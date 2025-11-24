(() => {
  const textFromSelectors = (selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent) {
        const text = el.textContent.trim();
        if (text.length > 2 && text.length < 300) {
          return text;
        }
      }
    }
    return '';
  };

  const metaContent = (name) => {
    const el =
      document.querySelector(`meta[name="${name}"]`) ||
      document.querySelector(`meta[property="${name}"]`);
    return el?.getAttribute('content')?.trim() || '';
  };

  const role =
    textFromSelectors([
      'h1[data-test="job-title"]',
      'h1[data-testid="jobTitle"]',
      'h1[class*="job"]',
      'h1',
      'h2[data-testid="jobTitle"]',
      'h2[class*="job"]',
      'h2'
    ]) || metaContent('og:title');

  const company =
    textFromSelectors([
      '[data-company-name]',
      '[data-testid="company-name"]',
      '[data-test="company-name"]',
      '.company',
      '.company-name',
      '.topcard__org-name-link',
      '.job-details-jobs-unified-top-card__company-name',
      'a[data-tracking-control-name*="company"]',
      'h3'
    ]) || metaContent('og:site_name');

  const descriptionContainer =
    document.querySelector('[data-test="jobDescription"]') ||
    document.querySelector('[data-testid="jobDescription"]') ||
    document.querySelector('#jobDescriptionText') ||
    document.querySelector('.jobsearch-jobDescriptionText') ||
    document.querySelector('article');

  let jobDescription = '';
  if (descriptionContainer) {
    jobDescription = descriptionContainer.innerText.trim();
  } else {
    const paragraphs = Array.from(document.querySelectorAll('p'))
      .map((p) => p.innerText.trim())
      .filter((txt) => txt.length > 60);
    jobDescription = paragraphs.slice(0, 10).join('\n\n');
  }

  return {
    role: role || document.title,
    company,
    jobDescription,
    url: window.location.href
  };
})();

