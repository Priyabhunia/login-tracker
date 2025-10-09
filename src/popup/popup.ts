// Enhanced Popup script for Email Tracker Extension

import { EmailMapping, DomainMappings } from '../utils/storage';

/**
 * Popup initialization
 */
document.addEventListener('DOMContentLoaded', initializePopup);

/**
 * Initialize popup functionality
 */
async function initializePopup(): Promise<void> {
  console.log('Email Tracker popup initialized');

  // Load and display email data organized by domain
  await loadEmailData();

  // Load tracking status
  await loadTrackingStatus();

  // Set up event listeners
  setupEventListeners();
}

/**
 * Load email data from storage organized by domain
 */
async function loadEmailData(): Promise<void> {
  try {
    // Show loading state
    showLoading();

    // Get email mappings from background script
    const response = await sendMessageToBackground('GET_EMAIL_MAPPINGS');

    if (response && response.mappings) {
      const mappings = response.mappings as DomainMappings;

      if (Object.keys(mappings).length === 0) {
        showNoData();
      } else {
        displayDomainOrganizedData(mappings);
      }
    } else {
      showNoData();
    }
  } catch (error) {
    console.error('Error loading email data:', error);
    showError('Failed to load email data');
  }
}

/**
 * Display email data organized by domain
 */
function displayDomainOrganizedData(mappings: DomainMappings): void {
  // Update statistics
  updateStatistics(mappings);

  // Create domain-organized list
  const container = document.getElementById('emails-container');
  if (!container) return;

  container.innerHTML = '';

  // Sort domains alphabetically
  const sortedDomains = Object.keys(mappings).sort();

  sortedDomains.forEach(domain => {
    const domainElement = createDomainElement(domain, mappings[domain]);
    container.appendChild(domainElement);
  });

  // Show email list
  showEmailList();
}

/**
 * Create domain container element
 */
function createDomainElement(domain: string, emails: EmailMapping[]): HTMLElement {
  const domainDiv = document.createElement('div');
  domainDiv.className = 'domain-item';

  const totalLogins = emails.reduce((sum, email) => sum + email.count, 0);

  domainDiv.innerHTML = `
    <div class="domain-header">
      <span class="domain-name">${escapeHtml(domain)}</span>
      <div class="domain-controls">
        <button class="domain-btn add-email" data-domain="${domain}" title="Add email">＋</button>
        <button class="domain-btn delete" data-domain="${domain}" title="Delete domain">×</button>
      </div>
    </div>
  `;

  // Add email items
  const emailsContainer = document.createElement('div');
  emailsContainer.className = 'domain-emails';

  emails.forEach(email => {
    const emailElement = createEmailElement(domain, email);
    emailsContainer.appendChild(emailElement);
  });

  domainDiv.appendChild(emailsContainer);
  return domainDiv;
}

/**
 * Create individual email element
 */
function createEmailElement(domain: string, email: EmailMapping): HTMLElement {
  const emailDiv = document.createElement('div');
  emailDiv.className = 'email-item';

  const lastUsed = new Date(email.timestamp).toLocaleString();
  const loginText = email.count === 1 ? 'login' : 'logins';

  emailDiv.innerHTML = `
    <div class="email-info">
      <div class="email-address">${escapeHtml(email.email)}</div>
      <div class="email-meta">
        <span>Last: ${lastUsed}</span> • <span>${email.count} ${loginText}</span>
      </div>
    </div>
    <div class="email-controls">
      <button class="email-btn edit" data-domain="${domain}" data-email="${email.email}" title="Edit">✏️</button>
      <button class="email-btn delete" data-domain="${domain}" data-email="${email.email}" title="Delete">×</button>
    </div>
  `;

  return emailDiv;
}

/**
 * Update statistics display
 */
function updateStatistics(mappings: DomainMappings): void {
  const domains = Object.keys(mappings);
  const totalEmails = domains.reduce((sum, domain) => sum + mappings[domain].length, 0);
  const totalLogins = domains.reduce((sum, domain) =>
    sum + mappings[domain].reduce((domainSum, email) => domainSum + email.count, 0), 0);

  const totalEmailsElement = document.getElementById('total-emails');
  const totalWebsitesElement = document.getElementById('total-websites');

  if (totalEmailsElement) totalEmailsElement.textContent = totalEmails.toString();
  if (totalWebsitesElement) totalWebsitesElement.textContent = domains.length.toString();
}

/**
 * Load tracking status from storage
 */
async function loadTrackingStatus(): Promise<void> {
  try {
    const response = await sendMessageToBackground('GET_TRACKING_STATUS');
    const isPaused = response && response.isPaused === true;

    updateTrackingButton(isPaused);
  } catch (error) {
    console.error('Error loading tracking status:', error);
  }
}

/**
 * Update tracking button based on status
 */
function updateTrackingButton(isPaused: boolean): void {
  const toggleButton = document.getElementById('toggle-tracking') as HTMLButtonElement;
  if (toggleButton) {
    if (isPaused) {
      toggleButton.textContent = '▶️ Resume Tracking';
      toggleButton.classList.add('paused');
    } else {
      toggleButton.textContent = '⏸️ Pause Tracking';
      toggleButton.classList.remove('paused');
    }
  }
}

/**
 * Set up event listeners
 */
function setupEventListeners(): void {
  // Clear data button
  const clearButton = document.getElementById('clear-data');
  if (clearButton) {
    clearButton.addEventListener('click', handleClearData);
  }

  // Add manual email button
  const addButton = document.getElementById('add-manual');
  if (addButton) {
    addButton.addEventListener('click', showManualAddForm);
  }

  // Toggle tracking button
  const toggleButton = document.getElementById('toggle-tracking');
  if (toggleButton) {
    toggleButton.addEventListener('click', handleToggleTracking);
  }

  // Delegate events for dynamic elements
  document.addEventListener('click', handleDynamicEvents);
}

/**
 * Handle dynamic events (for buttons added after initial load)
 */
function handleDynamicEvents(event: Event): void {
  const target = event.target as HTMLElement;

  // Domain add email button
  if (target.classList.contains('domain-btn') && target.classList.contains('add-email')) {
    const domain = target.getAttribute('data-domain');
    if (domain) {
      showAddEmailForm(domain);
    }
  }

  // Domain delete button
  if (target.classList.contains('domain-btn') && target.classList.contains('delete')) {
    const domain = target.getAttribute('data-domain');
    if (domain) {
      handleDeleteDomain(domain);
    }
  }

  // Email edit button
  if (target.classList.contains('email-btn') && target.classList.contains('edit')) {
    const domain = target.getAttribute('data-domain');
    const email = target.getAttribute('data-email');
    if (domain && email) {
      showEditEmailForm(domain, email);
    }
  }

  // Email delete button
  if (target.classList.contains('email-btn') && target.classList.contains('delete')) {
    const domain = target.getAttribute('data-domain');
    const email = target.getAttribute('data-email');
    if (domain && email) {
      handleDeleteEmail(domain, email);
    }
  }
}

/**
 * Show manual add form for new domain/email
 */
function showManualAddForm(): void {
  showAddEmailForm('');
}

/**
 * Show add email form
 */
function showAddEmailForm(domain: string): void {
  const container = document.getElementById('emails-container');
  if (!container) return;

  // Remove existing forms
  const existingForm = container.querySelector('.add-form');
  if (existingForm) {
    existingForm.remove();
  }

  const formDiv = document.createElement('div');
  formDiv.className = 'add-form';

  formDiv.innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label>Domain</label>
        <input type="text" id="domain-input" placeholder="example.com" value="${escapeHtml(domain)}">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="email-input" placeholder="user@example.com">
      </div>
    </div>
    <div class="form-actions">
      <button class="form-btn save" id="save-add">Add Email</button>
      <button class="form-btn cancel" id="cancel-add">Cancel</button>
    </div>
  `;

  // Insert at the top
  container.insertBefore(formDiv, container.firstChild);

  // Focus on email input
  const emailInput = document.getElementById('email-input') as HTMLInputElement;
  if (emailInput) {
    emailInput.focus();
  }

  // Set up form event listeners
  const saveBtn = document.getElementById('save-add');
  const cancelBtn = document.getElementById('cancel-add');

  if (saveBtn) {
    saveBtn.addEventListener('click', handleAddEmail);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => formDiv.remove());
  }
}

/**
 * Show edit email form
 */
function showEditEmailForm(domain: string, currentEmail: string): void {
  const container = document.getElementById('emails-container');
  if (!container) return;

  // Remove existing forms
  const existingForm = container.querySelector('.add-form');
  if (existingForm) {
    existingForm.remove();
  }

  const formDiv = document.createElement('div');
  formDiv.className = 'add-form';

  formDiv.innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label>Domain</label>
        <input type="text" id="edit-domain-input" placeholder="example.com" value="${escapeHtml(domain)}" readonly>
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="edit-email-input" placeholder="user@example.com" value="${escapeHtml(currentEmail)}">
      </div>
    </div>
    <div class="form-actions">
      <button class="form-btn save" id="save-edit">Update Email</button>
      <button class="form-btn cancel" id="cancel-edit">Cancel</button>
    </div>
  `;

  // Insert at the top
  container.insertBefore(formDiv, container.firstChild);

  // Focus on email input
  const emailInput = document.getElementById('edit-email-input') as HTMLInputElement;
  if (emailInput) {
    emailInput.focus();
    emailInput.select();
  }

  // Set up form event listeners
  const saveBtn = document.getElementById('save-edit');
  const cancelBtn = document.getElementById('cancel-edit');

  if (saveBtn) {
    saveBtn.addEventListener('click', handleEditEmail);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => formDiv.remove());
  }
}

/**
 * Handle edit email form submission
 */
async function handleEditEmail(): Promise<void> {
  const domainInput = document.getElementById('edit-domain-input') as HTMLInputElement;
  const emailInput = document.getElementById('edit-email-input') as HTMLInputElement;

  const domain = domainInput?.value.trim();
  const newEmail = emailInput?.value.trim();

  if (!domain || !newEmail) {
    alert('Please fill in both domain and email fields');
    return;
  }

  if (!isValidEmail(newEmail)) {
    alert('Please enter a valid email address');
    return;
  }

  try {
    // Send to background script for storage
    const response = await sendMessageToBackground('EDIT_EMAIL', { domain, oldEmail: '', newEmail });

    if (response && response.success) {
      // Reload data
      await loadEmailData();
    } else {
      alert('Failed to update email');
    }
  } catch (error) {
    console.error('Error updating email:', error);
    alert('Failed to update email');
  }
}

/**
 * Handle add email form submission
 */
async function handleAddEmail(): Promise<void> {
  const domainInput = document.getElementById('domain-input') as HTMLInputElement;
  const emailInput = document.getElementById('email-input') as HTMLInputElement;

  const domain = domainInput?.value.trim();
  const email = emailInput?.value.trim();

  if (!domain || !email) {
    alert('Please fill in both domain and email fields');
    return;
  }

  if (!isValidEmail(email)) {
    alert('Please enter a valid email address');
    return;
  }

  try {
    // Send to background script for storage
    const response = await sendMessageToBackground('ADD_EMAIL', { domain, email });

    if (response && response.success) {
      // Reload data
      await loadEmailData();
    } else {
      alert('Failed to add email');
    }
  } catch (error) {
    console.error('Error adding email:', error);
    alert('Failed to add email');
  }
}

/**
 * Handle delete domain
 */
async function handleDeleteDomain(domain: string): Promise<void> {
  if (!confirm(`Delete all emails for ${domain}?`)) {
    return;
  }

  try {
    const response = await sendMessageToBackground('DELETE_DOMAIN', { domain });

    if (response && response.success) {
      await loadEmailData();
    } else {
      alert('Failed to delete domain');
    }
  } catch (error) {
    console.error('Error deleting domain:', error);
    alert('Failed to delete domain');
  }
}

/**
 * Handle delete email
 */
async function handleDeleteEmail(domain: string, email: string): Promise<void> {
  if (!confirm(`Delete ${email} from ${domain}?`)) {
    return;
  }

  try {
    const response = await sendMessageToBackground('DELETE_EMAIL', { domain, email });

    if (response && response.success) {
      await loadEmailData();
    } else {
      alert('Failed to delete email');
    }
  } catch (error) {
    console.error('Error deleting email:', error);
    alert('Failed to delete email');
  }
}

/**
 * Handle toggle tracking button click
 */
async function handleToggleTracking(): Promise<void> {
  try {
    const response = await sendMessageToBackground('TOGGLE_TRACKING');

    if (response && response.success) {
      const isPaused = response.isPaused;
      updateTrackingButton(isPaused);

      // Show feedback to user
      const message = isPaused ? 'Tracking paused' : 'Tracking resumed';
      showTemporaryMessage(message);
    } else {
      showError('Failed to toggle tracking');
    }
  } catch (error) {
    console.error('Error toggling tracking:', error);
    showError('Failed to toggle tracking');
  }
}

/**
 * Handle clear data button click
 */
async function handleClearData(): Promise<void> {
  if (!confirm('Are you sure you want to clear all stored email data? This cannot be undone.')) {
    return;
  }

  try {
    const response = await sendMessageToBackground('CLEAR_MAPPINGS');

    if (response && response.success) {
      // Reload email data (should show no data now)
      await loadEmailData();
    } else {
      showError('Failed to clear data');
    }
  } catch (error) {
    console.error('Error clearing data:', error);
    showError('Failed to clear data');
  }
}

/**
 * Show temporary message to user
 */
function showTemporaryMessage(message: string): void {
  // Remove existing message
  const existingMessage = document.querySelector('.temp-message');
  if (existingMessage) {
    existingMessage.remove();
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = 'temp-message';
  messageDiv.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: #10b981;
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 12px;
    z-index: 10002;
    animation: slideInFade 0.3s ease-out;
  `;

  messageDiv.textContent = message;

  // Add CSS animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideInFade {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(messageDiv);

  // Remove after 3 seconds
  setTimeout(() => {
    messageDiv.style.animation = 'slideInFade 0.3s ease-out reverse';
    setTimeout(() => messageDiv.remove(), 300);
  }, 3000);
}

/**
 * Send message to background script
 */
function sendMessageToBackground(type: string, data?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Validate email address
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Show loading state
 */
function showLoading(): void {
  hideAllSections();
  const loadingElement = document.getElementById('loading');
  if (loadingElement) {
    loadingElement.style.display = 'block';
  }
}

/**
 * Show no data state
 */
function showNoData(): void {
  hideAllSections();
  const noDataElement = document.getElementById('no-data');
  if (noDataElement) {
    noDataElement.style.display = 'block';
  }
}

/**
 * Show email list
 */
function showEmailList(): void {
  hideAllSections();
  const emailListElement = document.getElementById('email-list');
  if (emailListElement) {
    emailListElement.style.display = 'block';
  }
}

/**
 * Show error message
 */
function showError(message: string): void {
  hideAllSections();

  // Create temporary error element
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.innerHTML = `
    <p style="color: #ef4444; text-align: center; padding: 20px;">
      ${escapeHtml(message)}
    </p>
  `;

  const mainContent = document.querySelector('.main-content');
  if (mainContent) {
    mainContent.appendChild(errorDiv);
  }
}

/**
 * Hide all main sections
 */
function hideAllSections(): void {
  const sections = ['loading', 'no-data', 'email-list'];
  sections.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.style.display = 'none';
    }
  });

  // Remove any error messages
  const errorMessages = document.querySelectorAll('.error-message');
  errorMessages.forEach(error => error.remove());

  // Remove any forms
  const forms = document.querySelectorAll('.add-form');
  forms.forEach(form => form.remove());
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}