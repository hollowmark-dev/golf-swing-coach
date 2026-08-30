import { init as initCapture } from './views/view-capture.js';
import { init as initHistory } from './views/view-history.js';
import { init as initDetail } from './views/view-detail.js';
import { requestPersistentStorage } from './storage-opfs.js';

const appEl = document.getElementById('app');
const navLinks = document.querySelectorAll('.tabs a');

const routes = {
  capture: { template: '#tpl-view-capture', init: initCapture },
  history: { template: '#tpl-view-history', init: initHistory },
  detail: { template: '#tpl-view-detail', init: initDetail },
};

function parseHash() {
  const hash = location.hash.replace(/^#/, '') || 'capture';
  const [route, param] = hash.split('/');
  return { route: routes[route] ? route : 'capture', param };
}

function updateNavActive(route) {
  const activeRoute = route === 'detail' ? 'history' : route;
  navLinks.forEach((link) => {
    link.classList.toggle('active', link.dataset.route === activeRoute);
  });
}

async function render() {
  const { route, param } = parseHash();
  const config = routes[route];
  updateNavActive(route);

  const template = document.querySelector(config.template);
  appEl.innerHTML = '';
  appEl.appendChild(template.content.cloneNode(true));

  try {
    await config.init(appEl, param);
  } catch (err) {
    console.error(`view init failed: ${route}`, err);
  }
}

window.addEventListener('hashchange', render);

requestPersistentStorage();
render();
