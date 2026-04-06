/**
 * nav.js - Navigation & UI Components
 * Builds authenticated navigation bar and footer disclaimer
 */

import { signOut, TIERS } from './auth.js';

/**
 * Render the authenticated navigation bar
 * Injects into element with id="app-nav"
 * @param {Object} session - User's auth session
 * @param {string} tier - User's tier/role
 */
function renderNav(session, tier) {
  const navContainer = document.getElementById('app-nav');
  if (!navContainer) {
    console.warn('Navigation container with id="app-nav" not found');
    return;
  }

  // Create nav HTML
  const navHTML = `
    <style>
      #app-nav {
        position: sticky;
        top: 0;
        z-index: 1000;
        background: rgba(0, 0, 0, 0.3);
        backdrop-filter: blur(10px);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      }

      .nav-wrapper {
        max-width: 1200px;
        margin: 0 auto;
        padding: 0 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        height: 70px;
      }

      .nav-logo {
        font-size: 18px;
        font-weight: 700;
        color: white;
        text-decoration: none;
        display: flex;
        align-items: center;
        gap: 8px;
        margin-right: 40px;
      }

      .nav-logo:hover {
        opacity: 0.8;
      }

      .nav-menu {
        display: flex;
        align-items: center;
        gap: 30px;
        flex: 1;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .nav-link, .nav-dropdown-toggle {
        color: white;
        text-decoration: none;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        background: none;
        border: none;
        padding: 0;
        transition: opacity 0.2s ease;
      }

      .nav-link:hover, .nav-dropdown-toggle:hover {
        opacity: 0.8;
      }

      .nav-dropdown {
        position: relative;
      }

      .nav-dropdown-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .nav-dropdown-menu {
        position: absolute;
        top: 100%;
        left: 0;
        background: rgba(20, 20, 20, 0.95);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 12px 0;
        min-width: 220px;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-8px);
        transition: opacity 0.2s ease, visibility 0.2s ease, transform 0.2s ease;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        margin-top: 8px;
      }

      .nav-dropdown:hover .nav-dropdown-menu {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      .nav-dropdown-item {
        color: white;
        text-decoration: none;
        font-size: 13px;
        padding: 10px 20px;
        display: block;
        transition: background 0.2s ease;
      }

      .nav-dropdown-item:hover {
        background: rgba(255, 255, 255, 0.1);
      }

      .nav-right {
        display: flex;
        align-items: center;
        gap: 20px;
        margin-left: auto;
      }

      .tier-badge {
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .tier-free {
        background: rgba(128, 128, 128, 0.2);
        color: rgba(200, 200, 200, 1);
      }

      .tier-comp_buddy {
        background: rgba(76, 175, 80, 0.2);
        color: #4CAF50;
      }

      .tier-pro {
        background: rgba(33, 150, 243, 0.2);
        color: #2196F3;
      }

      .tier-firm {
        background: rgba(255, 152, 0, 0.2);
        color: #FF9800;
      }

      .nav-sign-out {
        background: none;
        border: none;
        color: rgba(200, 200, 200, 1);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        padding: 0;
        transition: color 0.2s ease;
      }

      .nav-sign-out:hover {
        color: white;
      }

      .nav-hamburger {
        display: none;
        flex-direction: column;
        gap: 5px;
        cursor: pointer;
        background: none;
        border: none;
        padding: 8px;
      }

      .nav-hamburger span {
        width: 24px;
        height: 2px;
        background: white;
        transition: all 0.3s ease;
      }

      .nav-hamburger.active span:nth-child(1) {
        transform: rotate(45deg) translate(8px, 8px);
      }

      .nav-hamburger.active span:nth-child(2) {
        opacity: 0;
      }

      .nav-hamburger.active span:nth-child(3) {
        transform: rotate(-45deg) translate(7px, -7px);
      }

      @media (max-width: 768px) {
        .nav-menu, .nav-right {
          display: none;
        }

        .nav-menu.mobile-open, .nav-right.mobile-open {
          display: flex;
          flex-direction: column;
          position: absolute;
          top: 70px;
          left: 0;
          right: 0;
          background: rgba(20, 20, 20, 0.98);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding: 20px;
          gap: 15px;
          border-bottom: none;
        }

        .nav-right.mobile-open {
          flex-direction: row;
          justify-content: space-between;
          align-items: center;
          padding: 15px 20px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .nav-hamburger {
          display: flex;
        }

        .nav-dropdown-menu {
          position: static;
          background: rgba(40, 40, 40, 1);
          border: none;
          border-radius: 0;
          opacity: 1;
          visibility: visible;
          transform: none;
          box-shadow: none;
          margin: 0;
          margin-top: 10px;
          padding: 8px 0;
        }

        .nav-dropdown:hover .nav-dropdown-menu {
          opacity: 1;
          visibility: visible;
          transform: none;
        }

        .nav-logo {
          margin-right: auto;
        }

        .nav-wrapper {
          height: auto;
          padding: 0 20px;
        }
      }
    </style>

    <div class="nav-wrapper">
      <a href="/dashboard/" class="nav-logo">
        <span>THE COMP DESK</span>
      </a>

      <button class="nav-hamburger" id="nav-hamburger">
        <span></span>
        <span></span>
        <span></span>
      </button>

      <ul class="nav-menu" id="nav-menu">
        <li><a href="/" class="nav-link" style="color:#4f8ff7;">← Website</a></li>
        <li><a href="/dashboard/" class="nav-link">Dashboard</a></li>
        <li><a href="/calculators/" class="nav-link">Calculators</a></li>
        <li><a href="/calculators/pro.html" class="nav-link" style="color:#f59e0b;">Pro Suite</a></li>
        <li><a href="/dashboard/my-cases.html" class="nav-link" style="color:#3b82f6;">My Cases</a></li>
        <li class="nav-dropdown">
          <button class="nav-dropdown-toggle">Tools <span>▼</span></button>
          <div class="nav-dropdown-menu">
            <a href="/tools/settlement.html" class="nav-dropdown-item">Settlement Comparison</a>
            <a href="/tools/learning/" class="nav-dropdown-item">Learning Portal</a>
            <a href="/tools/find-doctor.html" class="nav-dropdown-item">Find a Doctor</a>
            <a href="/tools/ime-reminders.html" class="nav-dropdown-item">IME Reminders</a>
            <a href="/tools/utdm.html" class="nav-dropdown-item" style="color:#666">More Coming Soon</a>
          </div>
        </li>
        <li><a href="/account.html" class="nav-link">Account</a></li>
      </ul>

      <div class="nav-right" id="nav-right">
        <span class="tier-badge tier-${tier}">
          ${tier === 'free' ? 'Free' : tier === 'comp_buddy' ? 'Comp Buddy' : tier === 'pro' ? 'Pro' : 'Firm'}
        </span>
        <button class="nav-sign-out" id="nav-sign-out">Sign Out</button>
      </div>
    </div>
  `;

  navContainer.innerHTML = navHTML;

  // Mobile hamburger menu toggle
  const hamburger = document.getElementById('nav-hamburger');
  const navMenu = document.getElementById('nav-menu');
  const navRight = document.getElementById('nav-right');

  if (hamburger) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      navMenu.classList.toggle('mobile-open');
      navRight.classList.toggle('mobile-open');
    });

    // Close menu when a link is clicked
    const navLinks = navContainer.querySelectorAll('.nav-link, .nav-dropdown-item');
    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navMenu.classList.remove('mobile-open');
        navRight.classList.remove('mobile-open');
      });
    });
  }

  // Sign out button
  const signOutBtn = document.getElementById('nav-sign-out');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await signOut();
    });
  }
}

/**
 * Render the standard legal disclaimer footer
 * @returns {string} HTML for footer disclaimer
 */
function renderFooterDisclaimer() {
  return `
    <div style="
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(10px);
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      color: rgba(200, 200, 200, 0.8);
      font-size: 12px;
      padding: 20px;
      text-align: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
    ">
      <p style="margin: 0;">
        This tool is for informational purposes only and does not constitute legal advice. Comp Buddy is a document preparation service operated by NJJ Document Services, Inc.
      </p>
    </div>
  `;
}

/**
 * Render a public navigation bar for calculator/public pages.
 * Works for both authenticated and unauthenticated visitors.
 * @param {Object} userState - Result from getOptionalUser(): { session, tier }
 */
function renderPublicNav(userState) {
  const navContainer = document.getElementById('app-nav');
  if (!navContainer) return;

  const isLoggedIn = !!(userState && userState.session);
  const tier = isLoggedIn ? (userState.tier || 'free') : null;

  const tierLabel = {
    free: 'Free',
    comp_buddy: 'Comp Buddy',
    pro: 'Pro',
    firm: 'Firm'
  };

  const rightSection = isLoggedIn ? `
    <span class="tier-badge tier-${tier}" style="padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">
      ${tierLabel[tier] || tier}
    </span>
    <a href="/dashboard/" style="color:rgba(200,200,200,1);font-size:13px;font-weight:500;text-decoration:none;">Dashboard</a>
    <button class="nav-sign-out" id="nav-sign-out">Sign Out</button>
  ` : `
    <a href="/auth_v2.html" style="color:rgba(200,200,200,1);font-size:13px;font-weight:500;text-decoration:none;padding:8px 16px;border:1px solid rgba(255,255,255,0.2);border-radius:6px;transition:all 0.2s ease;" onmouseover="this.style.borderColor='rgba(255,255,255,0.5)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.2)'">Sign In</a>
    <a href="/auth_v2.html?mode=signup" style="color:#fff;font-size:13px;font-weight:600;text-decoration:none;padding:8px 16px;background:linear-gradient(135deg,#4CAF50 0%,#45a049 100%);border-radius:6px;transition:all 0.2s ease;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">Create Free Account</a>
  `;

  const navHTML = `
    <style>
      #app-nav {
        position: sticky;
        top: 0;
        z-index: 1000;
        background: rgba(0, 0, 0, 0.3);
        backdrop-filter: blur(10px);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      }
      .nav-wrapper {
        max-width: 1200px;
        margin: 0 auto;
        padding: 0 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        height: 70px;
      }
      .nav-logo {
        font-size: 18px;
        font-weight: 700;
        color: white;
        text-decoration: none;
        display: flex;
        align-items: center;
        gap: 8px;
        margin-right: 40px;
      }
      .nav-logo:hover { opacity: 0.8; }
      .nav-menu {
        display: flex;
        align-items: center;
        gap: 30px;
        flex: 1;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .nav-link, .nav-dropdown-toggle {
        color: white;
        text-decoration: none;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        background: none;
        border: none;
        padding: 0;
        transition: opacity 0.2s ease;
      }
      .nav-link:hover, .nav-dropdown-toggle:hover { opacity: 0.8; }
      .nav-dropdown { position: relative; }
      .nav-dropdown-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .nav-dropdown-menu {
        position: absolute;
        top: 100%;
        left: 0;
        background: rgba(20, 20, 20, 0.95);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 12px 0;
        min-width: 220px;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-8px);
        transition: opacity 0.2s ease, visibility 0.2s ease, transform 0.2s ease;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        margin-top: 8px;
      }
      .nav-dropdown:hover .nav-dropdown-menu {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }
      .nav-dropdown-item {
        color: white;
        text-decoration: none;
        font-size: 13px;
        padding: 10px 20px;
        display: block;
        transition: background 0.2s ease;
      }
      .nav-dropdown-item:hover { background: rgba(255, 255, 255, 0.1); }
      .nav-right {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-left: auto;
      }
      .tier-badge {
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .tier-free { background: rgba(128,128,128,0.2); color: rgba(200,200,200,1); }
      .tier-comp_buddy { background: rgba(76,175,80,0.2); color: #4CAF50; }
      .tier-pro { background: rgba(33,150,243,0.2); color: #2196F3; }
      .tier-firm { background: rgba(255,152,0,0.2); color: #FF9800; }
      .nav-sign-out {
        background: none;
        border: none;
        color: rgba(200,200,200,1);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        padding: 0;
        transition: color 0.2s ease;
      }
      .nav-sign-out:hover { color: white; }
      .nav-hamburger {
        display: none;
        flex-direction: column;
        gap: 5px;
        cursor: pointer;
        background: none;
        border: none;
        padding: 8px;
      }
      .nav-hamburger span {
        width: 24px;
        height: 2px;
        background: white;
        transition: all 0.3s ease;
      }
      @media (max-width: 768px) {
        .nav-menu, .nav-right { display: none; }
        .nav-menu.mobile-open, .nav-right.mobile-open {
          display: flex;
          flex-direction: column;
          position: absolute;
          top: 70px;
          left: 0;
          right: 0;
          background: rgba(20, 20, 20, 0.98);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding: 20px;
          gap: 15px;
        }
        .nav-right.mobile-open {
          flex-direction: row;
          flex-wrap: wrap;
          justify-content: center;
          padding: 15px 20px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          gap: 10px;
        }
        .nav-hamburger { display: flex; }
        .nav-logo { margin-right: auto; }
        .nav-wrapper { height: auto; padding: 0 20px; }
      }
    </style>

    <div class="nav-wrapper">
      <a href="/" class="nav-logo"><span>THE COMP DESK</span></a>

      <button class="nav-hamburger" id="nav-hamburger">
        <span></span><span></span><span></span>
      </button>

      <ul class="nav-menu" id="nav-menu">
        <li><a href="/calculators/" class="nav-link">Calculators</a></li>
        <li><a href="/calculators/pro.html" class="nav-link" style="color:#f59e0b;">Pro Suite</a></li>
        <li class="nav-dropdown">
          <button class="nav-dropdown-toggle">Tools <span>▼</span></button>
          <div class="nav-dropdown-menu">
            <a href="/tools/settlement.html" class="nav-dropdown-item">Settlement Comparison</a>
            <a href="/tools/find-doctor.html" class="nav-dropdown-item">Find a Doctor</a>
            <a href="/tools/learning/" class="nav-dropdown-item">Learning Portal</a>
          </div>
        </li>
        ${isLoggedIn ? '<li><a href="/dashboard/" class="nav-link">Dashboard</a></li>' : ''}
        ${isLoggedIn ? '<li><a href="/dashboard/my-cases.html" class="nav-link" style="color:#3b82f6;">My Cases</a></li>' : ''}
      </ul>

      <div class="nav-right" id="nav-right">
        ${rightSection}
      </div>
    </div>
  `;

  navContainer.innerHTML = navHTML;

  // Hamburger toggle
  const hamburger = document.getElementById('nav-hamburger');
  const navMenu = document.getElementById('nav-menu');
  const navRight = document.getElementById('nav-right');
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      navMenu.classList.toggle('mobile-open');
      navRight.classList.toggle('mobile-open');
    });
    const links = navContainer.querySelectorAll('.nav-link, .nav-dropdown-item');
    links.forEach(l => l.addEventListener('click', () => {
      hamburger.classList.remove('active');
      navMenu.classList.remove('mobile-open');
      navRight.classList.remove('mobile-open');
    }));
  }

  // Sign out button
  const signOutBtn = document.getElementById('nav-sign-out');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await signOut();
    });
  }
}

// Export public API
export {
  renderNav,
  renderPublicNav,
  renderFooterDisclaimer
};
