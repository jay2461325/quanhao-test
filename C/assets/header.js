(function () {
  'use strict';
  var host = document.currentScript && document.currentScript.previousElementSibling;
  if (!host || !host.matches('header.app-header')) return;
  var title = host.dataset.title || '全好蔬果｜報價管理系統';
  var userId = host.dataset.userId;
  var logoutId = host.dataset.logoutId;
  var backId = host.dataset.backId;
  var backLabel = host.dataset.backLabel || '返回';
  var brand = document.createElement('a');
  brand.className = 'app-header__brand';
  brand.href = 'index.html';
  brand.setAttribute('aria-label', '全好蔬果首頁');
  var logo = document.createElement('img');
  logo.src = 'assets/logo.png';
  logo.alt = '全好蔬果標誌';
  var name = document.createElement('span');
  name.className = 'app-header__title';
  name.textContent = title;
  brand.append(logo, name);
  var actions = document.createElement('div');
  actions.className = 'app-header__actions';
  if (userId) {
    var user = document.createElement('span');
    user.id = userId;
    user.className = 'app-header__user';
    user.textContent = '';
    actions.appendChild(user);
  }
  if (backId) {
    var back = document.createElement('button');
    back.type = 'button'; back.id = backId; back.className = 'app-header__button app-header__button--secondary';
    back.textContent = backLabel;
    actions.appendChild(back);
  }
  if (logoutId) {
    var logout = document.createElement('button');
    logout.type = 'button'; logout.id = logoutId; logout.className = 'app-header__button'; logout.textContent = '登出';
    actions.appendChild(logout);
  }
  host.replaceChildren(brand, actions);
})();
