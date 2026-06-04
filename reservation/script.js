const layout = document.querySelector("#reservationLayout");
const schedulerPane = document.querySelector("#schedulerPane");
const scheduleScroll = document.querySelector("#scheduleScroll");
const scheduleVerticalScroll = document.querySelector("#scheduleVerticalScroll");
const scheduleVerticalSpacer = document.querySelector("#scheduleVerticalSpacer");
const providerViewport = document.querySelector("#providerViewport");
const providerColumns = document.querySelector("#providerColumns");
const providerHeaderColumns = document.querySelector("#providerHeaderColumns");
const scheduleHorizontalBar = document.querySelector("#scheduleHorizontalBar");
const providerBottomScroll = document.querySelector("#providerBottomScroll");
const providerBottomSpacer = document.querySelector("#providerBottomSpacer");
const timeAxis = document.querySelector("#timeAxis");
const doctorList = document.querySelector("#doctorList");
const pageIndicator = document.querySelector("#pageIndicator");
const prevPageButton = document.querySelector("#prevPage");
const nextPageButton = document.querySelector("#nextPage");
const visibleDoctorCount = document.querySelector("#visibleDoctorCount");
const totalDoctorCount = document.querySelector("#totalDoctorCount");
const timeSelects = document.querySelectorAll(".time-range select");
const calendarSelect = document.querySelector(".reservation-form label select");
const sortButton = document.querySelector("#sortButton");
const sortPopover = document.querySelector("#sortPopover");
const pageEditActions = document.querySelector("#pageEditActions");
const pageEditCancel = document.querySelector("#pageEditCancel");
const pageEditSave = document.querySelector("#pageEditSave");

const storageKey = "reservation-popup-pane-widths";
const cardWidthStorageKey = "reservation-popup-card-width-preferences";
const pageLayoutStorageKey = "reservation-popup-page-layouts";
const defaultPageSize = 4;
const cardHandleWidth = 12;
const groupTabMinWidth = 56;
const groupTabGap = 2;
const groupTabPaddingX = 4;
const paneDefaults = { left: 360, right: 510 };
const paneLimits = {
  leftMin: 240,
  leftMax: 560,
  rightMin: 360,
  rightMax: 760,
  centerMin: 140,
  handles: 20,
};

const colorSet = [
  "#522bd4",
  "#3bb2a1",
  "#87539a",
  "#e2ba86",
  "#32905b",
  "#b12b22",
  "#4c73c9",
  "#cdea2c",
  "#fff2a8",
  "#647d43",
  "#772cd9",
  "#43edcc",
  "#6530ca",
  "#c8d531",
  "#9db0e0",
  "#db7d54",
];

const doctorSeed = [
  "김동규(신경과)",
  "권다영(내과)",
  "강세린(내과)",
  "권예은(이비인후과)",
  "김성진(이비인후과)",
  "김영진(내과)",
  "김우진(내과)",
  "김유섭(응급의학과)",
  "김태석(내과)",
  "김희네(내과)",
  "문재영(응급의학과)",
  "문재영(소아청소년과)",
  "김유선(내과)",
  "김정민(내과)",
];

const providers = doctorSeed.map((name, index) => {
  const count = index === 7 ? 1 : 0;
  return {
    id: index + 1,
    name,
    count,
    color: colorSet[index % colorSet.length],
  };
});

const times = buildTimes();
const defaultStartIndex = 0;
const cardViewModes = {
  default: { label: "캘린더 기본 보기", maxColumns: 4, targetWidth: 245 },
  single: { label: "캘린더 하나 보기", maxColumns: 1, targetWidth: 245 },
  max: { label: "캘린더 모두 보기", maxColumns: Number.POSITIVE_INFINITY, targetWidth: 56 },
};

const activeProviderIds = new Set(providers.map((provider) => provider.id));
const fixedBusyStartSlot = 19;

let viewMode = "default";
let previousNonSingleViewMode = "default";
let visibleCount = 4;
let firstVisibleIndex = defaultStartIndex >= 0 ? defaultStartIndex : 0;
let selectedSlot = 19;
let selectionEndSlot = 19;
let selectedProviderId = null;
let columnWeights = [];
let columnWeightKeys = [];
let itemWidthWeights = readStoredCardWeights();
let calendarOrder = providers.map((provider) => provider.id);
let pageLayouts = readStoredPageLayouts();
let currentPageIndex = getInitialPageIndex();
let calendarGroups = [];
let groupIdSequence = 1;
let activeGroupProviderIds = new Map();
let activeActionMenu = null;
let activePageContextMenu = null;
let draggedTabProviderId = null;
let currentVisibleItems = [];
let tabClickTimer = null;
let draggedCardProviderId = null;
let draggedPageIndex = null;
let lastCardDragClientX = null;
let lastCardDragClientY = null;
let cardDragEdgeTimer = null;
let cardDragEdgeDirection = 0;
let toastTimer = null;
let mergeFocusTimer = null;
let resizeLimitFeedbackTimer = null;
let lastResizeLimitToastAt = 0;
let isSyncingVerticalScroll = false;
let isPageEditMode = false;
let pageWidthEditVersions = new Map();
let hiddenWidthStates = new Map();
let autoFitPageIndexes = new Set();
let pageEditSnapshot = null;
let isCalendarDragPageCueVisible = false;

function buildTimes() {
  const result = [];

  for (let hour = 15; hour <= 19; hour += 1) {
    for (let minute = 0; minute < 60; minute += 10) {
      if (hour === 19 && minute > 40) break;
      result.push({ hour, minute, label: formatKoreanTime(hour, minute) });
    }
  }

  return result;
}

function formatKoreanTime(hour, minute) {
  const period = hour < 12 ? "오전" : "오후";
  const twelveHour = hour % 12 || 12;
  return `${period} ${String(twelveHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function readStoredWidths() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey));
    if (!parsed) return { ...paneDefaults };

    return {
      left: Number.isFinite(parsed.left) ? parsed.left : paneDefaults.left,
      right: Number.isFinite(parsed.right) ? parsed.right : paneDefaults.right,
    };
  } catch {
    return { ...paneDefaults };
  }
}

function readStoredCardWeights() {
  try {
    const parsed = JSON.parse(localStorage.getItem(cardWidthStorageKey));
    if (!parsed || typeof parsed !== "object") return new Map();

    return new Map(
      Object.entries(parsed).filter(([, value]) => Number.isFinite(value) && value > 0),
    );
  } catch {
    return new Map();
  }
}

function buildDefaultPageLayouts(providerIds = providers.map((provider) => provider.id)) {
  const pages = [];
  for (let index = 0; index < providerIds.length; index += defaultPageSize) {
    pages.push(providerIds.slice(index, index + defaultPageSize));
  }

  return pages.length ? pages : [[]];
}

function normalizePageLayouts(layouts) {
  const validIds = new Set(providers.map((provider) => provider.id));
  const seenIds = new Set();
  const pages = [];

  if (Array.isArray(layouts)) {
    layouts.forEach((page) => {
      if (!Array.isArray(page)) return;
      const nextPage = [];
      page.forEach((providerId) => {
        const id = Number(providerId);
        if (!validIds.has(id) || seenIds.has(id)) return;
        seenIds.add(id);
        nextPage.push(id);
      });
      pages.push(nextPage);
    });
  }

  const missingIds = providers.map((provider) => provider.id).filter((providerId) => !seenIds.has(providerId));
  for (let index = 0; index < missingIds.length; index += defaultPageSize) {
    pages.push(missingIds.slice(index, index + defaultPageSize));
  }

  return pages.length ? pages : [[]];
}

function readStoredPageLayouts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(pageLayoutStorageKey));
    return normalizePageLayouts(Array.isArray(parsed) ? parsed : buildDefaultPageLayouts());
  } catch {
    return normalizePageLayouts(buildDefaultPageLayouts());
  }
}

function storeWidths(widths) {
  localStorage.setItem(storageKey, JSON.stringify(widths));
}

function storeCardWeights() {
  localStorage.setItem(cardWidthStorageKey, JSON.stringify(Object.fromEntries(itemWidthWeights)));
}

function storePageLayouts() {
  localStorage.setItem(pageLayoutStorageKey, JSON.stringify(pageLayouts));
}

function getInitialPageIndex() {
  const targetProviderId = providers[defaultStartIndex]?.id || providers[0]?.id;
  const pageIndex = pageLayouts.findIndex((page) => page.includes(targetProviderId));
  return pageIndex >= 0 ? pageIndex : 0;
}

function compactPageLayouts() {
  pageLayouts = normalizePageLayouts(pageLayouts);
  if (!pageLayouts.length) {
    pageLayouts = [[]];
  }
  currentPageIndex = clamp(currentPageIndex, 0, pageLayouts.length - 1);
}

function syncCalendarOrderFromPageLayouts() {
  compactPageLayouts();
  calendarOrder = pageLayouts.flat();
}

function getProviderIdsInPageOrder() {
  const orderedIds = pageLayouts.flat().filter((providerId, index, ids) => ids.indexOf(providerId) === index);
  const missingIds = providers
    .map((provider) => provider.id)
    .filter((providerId) => !orderedIds.includes(providerId));
  return [...orderedIds, ...missingIds];
}

function normalizeWidths(left, right, priority = "center") {
  const total = layout.getBoundingClientRect().width;
  const maxLeft = Math.max(
    paneLimits.leftMin,
    Math.min(paneLimits.leftMax, total - paneLimits.rightMin - paneLimits.handles - paneLimits.centerMin),
  );
  const maxRight = Math.max(
    paneLimits.rightMin,
    Math.min(paneLimits.rightMax, total - paneLimits.leftMin - paneLimits.handles - paneLimits.centerMin),
  );

  let nextLeft = clamp(left, paneLimits.leftMin, maxLeft);
  let nextRight = clamp(right, paneLimits.rightMin, maxRight);
  const centerWidth = total - nextLeft - nextRight - paneLimits.handles;

  if (centerWidth < paneLimits.centerMin) {
    const shortage = paneLimits.centerMin - centerWidth;
    if (priority === "left") {
      nextRight = Math.max(paneLimits.rightMin, nextRight - shortage);
    } else {
      nextLeft = Math.max(paneLimits.leftMin, nextLeft - shortage);
    }
  }

  return {
    left: Math.round(nextLeft),
    right: Math.round(nextRight),
  };
}

function applyWidths(left, right, options = {}) {
  const normalized = normalizeWidths(left, right, options.priority);
  layout.style.setProperty("--left-width", `${normalized.left}px`);
  layout.style.setProperty("--right-width", `${normalized.right}px`);
  updateHandleValues(normalized);

  if (options.store !== false) {
    storeWidths(normalized);
  }

  requestAnimationFrame(updateVisibleColumns);
}

function getCurrentWidths() {
  const styles = getComputedStyle(layout);
  return {
    left: parseFloat(styles.getPropertyValue("--left-width")) || paneDefaults.left,
    right: parseFloat(styles.getPropertyValue("--right-width")) || paneDefaults.right,
  };
}

function updateHandleValues(widths = getCurrentWidths()) {
  document.querySelectorAll("[data-resize-handle]").forEach((handle) => {
    const type = handle.dataset.resizeHandle;
    const value = type === "left" ? widths.left : widths.right;
    const min = type === "left" ? paneLimits.leftMin : paneLimits.rightMin;
    const max = type === "left" ? paneLimits.leftMax : paneLimits.rightMax;
    handle.setAttribute("aria-valuemin", String(min));
    handle.setAttribute("aria-valuemax", String(max));
    handle.setAttribute("aria-valuenow", String(Math.round(value)));
  });
}

function attachResizeHandles() {
  document.querySelectorAll("[data-resize-handle]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      const type = handle.dataset.resizeHandle;
      const startX = event.clientX;
      const startWidths = getCurrentWidths();

      handle.setPointerCapture(event.pointerId);
      handle.classList.add("active");
      layout.classList.add("is-resizing");

      const onMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const left = type === "left" ? startWidths.left + delta : startWidths.left;
        const right = type === "right" ? startWidths.right - delta : startWidths.right;
        applyWidths(left, right, { priority: type, store: false });
      };

      const onEnd = () => {
        handle.classList.remove("active");
        layout.classList.remove("is-resizing");
        storeWidths(getCurrentWidths());
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onEnd);
        handle.removeEventListener("pointercancel", onEnd);
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onEnd);
      handle.addEventListener("pointercancel", onEnd);
    });

    handle.addEventListener("dblclick", () => {
      applyWidths(paneDefaults.left, paneDefaults.right);
    });

    handle.addEventListener("keydown", (event) => {
      const type = handle.dataset.resizeHandle;
      const step = event.shiftKey ? 48 : 24;
      const current = getCurrentWidths();
      let nextLeft = current.left;
      let nextRight = current.right;

      if (event.key === "ArrowLeft") {
        if (type === "left") nextLeft -= step;
        if (type === "right") nextRight += step;
      } else if (event.key === "ArrowRight") {
        if (type === "left") nextLeft += step;
        if (type === "right") nextRight -= step;
      } else if (event.key === "Home") {
        if (type === "left") nextLeft = paneLimits.leftMin;
        if (type === "right") nextRight = paneLimits.rightMax;
      } else if (event.key === "End") {
        if (type === "left") nextLeft = paneLimits.leftMax;
        if (type === "right") nextRight = paneLimits.rightMin;
      } else {
        return;
      }

      event.preventDefault();
      applyWidths(nextLeft, nextRight, { priority: type });
    });
  });
}

function renderDoctorList() {
  doctorList.innerHTML = "";
  getProviderIdsInPageOrder().forEach((providerId) => {
    const provider = getProviderById(providerId);
    if (!provider) return;

    const label = document.createElement("label");
    label.className = "doctor-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = activeProviderIds.has(provider.id);

    const name = document.createElement("span");
    name.textContent = provider.name;

    const dot = document.createElement("i");
    dot.className = "doctor-color";
    dot.style.background = provider.color;
    dot.setAttribute("aria-hidden", "true");

    checkbox.addEventListener("change", () => {
      const affectedPageIndex = getProviderPageIndex(provider.id);
      if (checkbox.checked) {
        activeProviderIds.add(provider.id);
        applyReturningProviderWidthPolicy(provider.id, affectedPageIndex);
        if (affectedPageIndex !== currentPageIndex) {
          showToast(`${provider.name} 캘린더가 ${affectedPageIndex + 1}페이지에 표시되었습니다`);
        }
      } else {
        captureHiddenProviderWidthState(provider.id, affectedPageIndex);
        activeProviderIds.delete(provider.id);
        refitPageAfterCalendarRemoval(affectedPageIndex);
      }
      label.style.opacity = checkbox.checked ? "1" : "0.45";
      syncSelectedProvider();
      renderScheduler({ resetWeights: true });
    });

    label.append(checkbox, name, dot);
    doctorList.append(label);
  });
}

function renderCalendarSelect() {
  if (!calendarSelect) return;

  calendarSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "선택";
  calendarSelect.append(placeholder);

  providers.forEach((provider) => {
    const option = document.createElement("option");
    option.value = String(provider.id);
    option.textContent = provider.name;
    calendarSelect.append(option);
  });
}

function updateCalendarField() {
  if (!calendarSelect || !selectedProviderId) return;

  const provider = getProviderById(selectedProviderId);
  if (!provider) return;

  if (!Array.from(calendarSelect.options).some((option) => option.value === String(provider.id))) {
    const option = document.createElement("option");
    option.value = String(provider.id);
    option.textContent = provider.name;
    calendarSelect.append(option);
  }

  calendarSelect.value = String(provider.id);
}

function renderTimeAxis() {
  timeAxis.innerHTML = "";
  times.forEach((time) => {
    const label = document.createElement("div");
    label.className = "time-label";
    label.textContent = time.label;
    timeAxis.append(label);
  });
}

function getChipColor(hex) {
  return `${hex}22`;
}

function getProviderLabel(provider) {
  return provider.count ? `${provider.name} ${provider.count}건` : provider.name;
}

function getProviderById(providerId) {
  return providers.find((provider) => provider.id === providerId);
}

function getActiveProviders() {
  return calendarOrder
    .map((providerId) => getProviderById(providerId))
    .filter((provider) => provider && activeProviderIds.has(provider.id));
}

function createGroupId() {
  const id = `group-${groupIdSequence}`;
  groupIdSequence += 1;
  return id;
}

function findGroupByProvider(providerId) {
  return calendarGroups.find((group) => group.providerIds.includes(providerId)) || null;
}

function removeEmptyCalendarGroups(keepGroupId = null) {
  calendarGroups = calendarGroups
    .map((group) => ({
      ...group,
      providerIds: group.providerIds.filter((providerId) => activeProviderIds.has(providerId)),
    }))
    .filter((group) => group.id === keepGroupId || group.providerIds.length >= 2);

  const existingGroupIds = new Set();
  calendarGroups.forEach((group) => {
    existingGroupIds.add(group.id);
    const activeProviderId = activeGroupProviderIds.get(group.id);
    if (!group.providerIds.includes(activeProviderId)) {
      activeGroupProviderIds.set(group.id, group.providerIds[0]);
    }
  });

  Array.from(activeGroupProviderIds.keys()).forEach((groupId) => {
    if (!existingGroupIds.has(groupId)) {
      activeGroupProviderIds.delete(groupId);
    }
  });
}

function syncCalendarGroups() {
  removeEmptyCalendarGroups();
}

function getDisplayItems() {
  syncCalendarGroups();

  const activeProviders = getActiveProviders();
  if (!calendarGroups.length) {
    return activeProviders.map((provider) => ({ type: "provider", id: `provider-${provider.id}`, provider }));
  }

  const items = [];
  const insertedGroupIds = new Set();

  activeProviders.forEach((provider) => {
    const group = findGroupByProvider(provider.id);
    if (group) {
      if (!insertedGroupIds.has(group.id)) {
        const groupProviders = group.providerIds
          .map((providerId) => getProviderById(providerId))
          .filter((groupProvider) => groupProvider && activeProviderIds.has(groupProvider.id));
        items.push({ type: "group", id: group.id, groupId: group.id, providers: groupProviders });
        insertedGroupIds.add(group.id);
      }
      return;
    }

    items.push({ type: "provider", id: `provider-${provider.id}`, provider });
  });

  return items;
}

function itemContainsProvider(item, providerId) {
  if (!providerId) return false;
  if (item.type === "provider") return item.provider.id === providerId;
  return item.providers.some((provider) => provider.id === providerId);
}

function getItemProviderIds(item) {
  if (!item) return [];
  return item.type === "group" ? item.providers.map((provider) => provider.id) : [item.provider.id];
}

function usesManualPages() {
  return viewMode === "default" || isPageEditMode;
}

function getProviderPageIndex(providerId) {
  const pageIndex = pageLayouts.findIndex((page) => page.includes(providerId));
  return pageIndex >= 0 ? pageIndex : 0;
}

function getPageActiveProviderIds(pageIndex) {
  return (pageLayouts[pageIndex] || []).filter((providerId) => activeProviderIds.has(providerId));
}

function getPageDisplayItems(pageIndex, allItems = getDisplayItems()) {
  const pageProviderIds = new Set(getPageActiveProviderIds(pageIndex));
  return allItems.filter((item) => getItemProviderIds(item).some((providerId) => pageProviderIds.has(providerId)));
}

function getPageItemCount(pageIndex, allItems = getDisplayItems()) {
  return getPageDisplayItems(pageIndex, allItems).length;
}

function ensurePageIndex(pageIndex) {
  while (pageIndex >= pageLayouts.length) {
    pageLayouts.push([]);
  }

  return clamp(pageIndex, 0, pageLayouts.length - 1);
}

function getMovablePageProviderIds(providerId) {
  const id = Number(providerId);
  const group = findGroupByProvider(id);
  if (group) return [...group.providerIds];

  return [id];
}

function moveProvidersToPage(providerIds, targetPageIndex, beforeProviderId = null, options = {}) {
  const movingIds = providerIds
    .map(Number)
    .filter((providerId, index, ids) => providers.some((provider) => provider.id === providerId) && ids.indexOf(providerId) === index);
  if (!movingIds.length) return false;

  closeCalendarActionMenu();

  targetPageIndex = Math.max(0, targetPageIndex);
  const primaryId = movingIds[0];
  const previousPageIndex = getProviderPageIndex(primaryId);
  const previousCurrentPage = currentPageIndex;
  const movingWidthStates = new Map(movingIds.map((providerId) => [providerId, captureProviderWidthState(providerId)]));
  const targetIndex = ensurePageIndex(targetPageIndex);
  const movingSet = new Set(movingIds);

  pageLayouts = pageLayouts.map((page) => page.filter((itemId) => !movingSet.has(itemId)));
  const targetPage = pageLayouts[targetIndex] || [];
  const insertIndex = beforeProviderId ? targetPage.indexOf(beforeProviderId) : -1;
  targetPage.splice(insertIndex >= 0 ? insertIndex : targetPage.length, 0, ...movingIds);
  pageLayouts[targetIndex] = targetPage;

  if (!pageLayouts.length) {
    pageLayouts = [movingIds];
  }

  const nextPageIndex = getProviderPageIndex(primaryId);
  currentPageIndex = options.stayOnCurrentPage
    ? clamp(previousCurrentPage, 0, pageLayouts.length - 1)
    : nextPageIndex;
  syncCalendarOrderFromPageLayouts();
  if (previousPageIndex !== nextPageIndex) {
    refitPageAfterCalendarRemoval(previousPageIndex);
    resetProviderWidthPreferences(movingIds);
    restoreMovedProviderWidths(movingWidthStates, nextPageIndex);
  }
  storePageLayouts();
  draggedCardProviderId = null;
  draggedTabProviderId = null;
  isCalendarDragPageCueVisible = false;
  providerColumns.classList.remove("is-dragging-cards", "is-dragging-tabs");
  renderScheduler({ resetWeights: true });
  renderDoctorList();

  if (!options.silent) {
    const provider = getProviderById(primaryId);
    const targetLabel = `${nextPageIndex + 1}페이지`;
    const message =
      options.message ||
      (movingIds.length > 1
        ? `묶인 캘린더 카드를 ${targetLabel}로 이동했습니다`
        : `${provider?.name || "캘린더"}를 ${targetLabel}로 이동했습니다`);
    showToast(message);
  }

  return previousPageIndex !== nextPageIndex || previousCurrentPage !== currentPageIndex;
}

function moveProviderToPage(providerId, targetPageIndex, beforeProviderId = null, options = {}) {
  return moveProvidersToPage([providerId], targetPageIndex, beforeProviderId, options);
}

function moveCalendarUnitToPage(providerId, targetPageIndex, beforeProviderId = null, options = {}) {
  return moveProvidersToPage(getMovablePageProviderIds(providerId), targetPageIndex, beforeProviderId, options);
}

function moveProviderToRelativePage(providerId, direction, options = {}) {
  const sourcePageIndex = getProviderPageIndex(providerId);
  const targetPageIndex = clamp(sourcePageIndex + direction, 0, pageLayouts.length - 1);
  if (targetPageIndex === sourcePageIndex) {
    showToast(direction < 0 ? "이미 첫 페이지입니다" : "이미 마지막 페이지입니다");
    return;
  }

  moveCalendarUnitToPage(providerId, targetPageIndex, null, {
    stayOnCurrentPage: options.stayOnCurrentPage !== false,
  });
}

function moveProviderToNewPage(providerId, options = {}) {
  moveCalendarUnitToPage(providerId, pageLayouts.length, null, {
    stayOnCurrentPage: options.stayOnCurrentPage !== false,
  });
}

function moveProviderToFirstPage(providerId, options = {}) {
  if (getProviderPageIndex(providerId) === 0) {
    showToast("이미 첫 페이지입니다");
    return;
  }

  moveCalendarUnitToPage(providerId, 0, null, {
    stayOnCurrentPage: options.stayOnCurrentPage !== false,
  });
}

function moveProviderToLastPage(providerId, options = {}) {
  const lastPageIndex = Math.max(0, pageLayouts.length - 1);
  if (getProviderPageIndex(providerId) === lastPageIndex) {
    showToast("이미 마지막 페이지입니다");
    return;
  }

  moveCalendarUnitToPage(providerId, lastPageIndex, null, {
    stayOnCurrentPage: options.stayOnCurrentPage !== false,
  });
}

function reorderPageLayout(sourceIndex, targetIndex) {
  if (sourceIndex === null || sourceIndex === targetIndex) return;
  if (!pageLayouts[sourceIndex] || !pageLayouts[targetIndex]) return;

  const nextLayouts = [...pageLayouts];
  const [movedPage] = nextLayouts.splice(sourceIndex, 1);
  nextLayouts.splice(targetIndex, 0, movedPage);
  pageLayouts = nextLayouts;
  currentPageIndex = targetIndex;
  syncCalendarOrderFromPageLayouts();
  storePageLayouts();
  renderScheduler({ resetWeights: true });
  renderDoctorList();
  showToast("페이지 순서를 변경했습니다");
}

function placeProvidersOnAnchorPage(providerIds, anchorProviderId) {
  const anchorPageIndex = getProviderPageIndex(anchorProviderId);
  const anchorPage = pageLayouts[anchorPageIndex] || [];
  const anchorIndex = Math.max(0, anchorPage.indexOf(anchorProviderId));
  const movingIds = providerIds.map(Number);
  const movingSet = new Set(movingIds);

  pageLayouts = pageLayouts.map((page) => page.filter((providerId) => !movingSet.has(providerId)));
  const nextAnchorPage = pageLayouts[anchorPageIndex] || [];
  nextAnchorPage.splice(Math.min(anchorIndex, nextAnchorPage.length), 0, ...movingIds);
  pageLayouts[anchorPageIndex] = nextAnchorPage;
  currentPageIndex = anchorPageIndex;
  syncCalendarOrderFromPageLayouts();
  resetPageItemWeights(anchorPageIndex);
  storePageLayouts();
  renderDoctorList();
}

function getDisplayItemByProviderId(displayItems, providerId) {
  return displayItems.find((item) => itemContainsProvider(item, providerId)) || null;
}

function moveProviderIdsToPageLayout(providerIds, targetPageIndex) {
  const movingIds = providerIds.map(Number).filter((providerId, index, ids) => ids.indexOf(providerId) === index);
  if (!movingIds.length) return false;

  const movingSet = new Set(movingIds);
  const targetIndex = ensurePageIndex(targetPageIndex);
  pageLayouts = pageLayouts.map((page) => page.filter((providerId) => !movingSet.has(providerId)));
  pageLayouts[targetIndex] = [...(pageLayouts[targetIndex] || []), ...movingIds];
  resetProviderWidthPreferences(movingIds);
  return true;
}

function fillManualPageFromFollowing(pageIndex, desiredItemCount) {
  if (!usesManualPages() || desiredItemCount <= 0) return;

  let displayItems = getDisplayItems();
  let guard = providers.length;
  while (getPageItemCount(pageIndex, displayItems) < desiredItemCount && guard > 0) {
    guard -= 1;
    const targetPageIds = new Set(pageLayouts[pageIndex] || []);
    let candidateIds = null;

    for (let nextPageIndex = pageIndex + 1; nextPageIndex < pageLayouts.length; nextPageIndex += 1) {
      const nextPage = pageLayouts[nextPageIndex] || [];
      for (const providerId of nextPage) {
        if (!activeProviderIds.has(providerId)) continue;

        const item = getDisplayItemByProviderId(displayItems, providerId);
        const itemIds = getItemProviderIds(item);
        if (itemIds.length && !itemIds.some((id) => targetPageIds.has(id))) {
          candidateIds = itemIds;
          break;
        }
      }
      if (candidateIds) break;
    }

    if (!candidateIds) break;
    moveProviderIdsToPageLayout(candidateIds, pageIndex);
    displayItems = getDisplayItems();
  }

  syncCalendarOrderFromPageLayouts();
  resetPageItemWeights(pageIndex);
  storePageLayouts();
  renderDoctorList();
}

function getPrimaryProviderIdFromItem(item) {
  if (!item) return null;
  if (item.type === "provider") return item.provider.id;

  const rememberedProviderId = activeGroupProviderIds.get(item.groupId);
  if (item.providers.some((provider) => provider.id === rememberedProviderId)) {
    return rememberedProviderId;
  }

  return item.providers[0]?.id || null;
}

function getDisplayItemOrderIndex(item, fallbackProviderId, order = calendarOrder) {
  const itemIds = new Set(getItemProviderIds(item));
  const index = order.findIndex((providerId) => itemIds.has(providerId));
  if (index >= 0) return index;

  return Math.max(0, order.indexOf(fallbackProviderId));
}

function getActiveProviderIdsInOrder() {
  const activeIds = providers.filter((provider) => activeProviderIds.has(provider.id)).map((provider) => provider.id);
  const orderedIds = calendarOrder.filter((providerId) => activeProviderIds.has(providerId));
  return [...orderedIds, ...activeIds.filter((providerId) => !orderedIds.includes(providerId))];
}

function preparePageEditModeForCurrentView() {
  if (viewMode === "max") {
    const activeIds = getActiveProviderIdsInOrder();
    pageLayouts = [activeIds];
    currentPageIndex = 0;
    syncCalendarOrderFromPageLayouts();
    storePageLayouts();
    return;
  }

  if (viewMode === "single") {
    const displayItems = getDisplayItems();
    const focusItem = displayItems[getPreferredSingleIndex(displayItems)] || displayItems[0];
    const focusProviderId = selectedProviderId || getPrimaryProviderIdFromItem(focusItem);
    currentPageIndex = getProviderPageIndex(focusProviderId);
  }
}

function syncSelectedProvider() {
  syncCalendarGroups();
  const activeProviders = getActiveProviders();
  if (selectedProviderId && !activeProviders.some((provider) => provider.id === selectedProviderId)) {
    selectedProviderId = null;
  }
}

function getSelectedProviderIndex(activeProviders = getActiveProviders()) {
  if (!selectedProviderId) return -1;
  return activeProviders.findIndex((provider) => provider.id === selectedProviderId);
}

function getSelectedDisplayIndex(displayItems = getDisplayItems()) {
  if (!selectedProviderId) return -1;
  return displayItems.findIndex((item) => itemContainsProvider(item, selectedProviderId));
}

function getItemWidthKey(item) {
  if (!item) return "";
  if (item.type === "group") return `${viewMode}:group:${item.groupId}`;

  return `${viewMode}:provider:${item.provider.id}`;
}

function getCurrentColumnWeightKeys(count = visibleCount) {
  return currentVisibleItems.slice(0, count).map((item) => getItemWidthKey(item));
}

function getStoredItemWeight(item) {
  const value = itemWidthWeights.get(getItemWidthKey(item));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function getProviderWidthKey(providerId, mode = viewMode) {
  return `${mode}:provider:${providerId}`;
}

function getPageWidthEditVersion(pageIndex) {
  return pageWidthEditVersions.get(pageIndex) || 0;
}

function getPageWidthSignature(pageIndex, excludeProviderId = null) {
  const excludedId = excludeProviderId === null ? null : Number(excludeProviderId);
  return (pageLayouts[pageIndex] || [])
    .filter((providerId) => providerId !== excludedId && activeProviderIds.has(providerId))
    .join(",");
}

function markCurrentPageWidthsTouched() {
  if (!usesManualPages()) return;

  pageWidthEditVersions.set(currentPageIndex, getPageWidthEditVersion(currentPageIndex) + 1);
  autoFitPageIndexes.delete(currentPageIndex);
}

function getCurrentProviderWeight(providerId) {
  const visibleIndex = currentVisibleItems.findIndex((item) => itemContainsProvider(item, providerId));
  const visibleWeight = columnWeights[visibleIndex];
  if (Number.isFinite(visibleWeight) && visibleWeight > 0) return visibleWeight;

  const storedWeight = itemWidthWeights.get(getProviderWidthKey(providerId));
  return Number.isFinite(storedWeight) && storedWeight > 0 ? storedWeight : null;
}

function getCurrentProviderPixelWidth(providerId) {
  const cards = Array.from(providerColumns.querySelectorAll(".provider-card"));
  const card = cards.find((candidate) => {
    const groupId = candidate.dataset.groupId;
    if (groupId) {
      return findGroupByProvider(providerId)?.id === groupId;
    }

    return Number(candidate.dataset.providerId) === Number(providerId);
  });

  const width = card?.getBoundingClientRect().width;
  return Number.isFinite(width) && width > 0 ? width : null;
}

function captureProviderWidthState(providerId) {
  return {
    weight: getCurrentProviderWeight(providerId),
    widthPx: getCurrentProviderPixelWidth(providerId),
  };
}

function captureHiddenProviderWidthState(providerId, pageIndex) {
  hiddenWidthStates.set(providerId, {
    mode: viewMode,
    pageIndex,
    version: getPageWidthEditVersion(pageIndex),
    signature: getPageWidthSignature(pageIndex, providerId),
    weight: getCurrentProviderWeight(providerId),
    widthPx: getCurrentProviderPixelWidth(providerId),
  });
}

function getRestoredWidthKey(targetItem, providerId) {
  return targetItem ? getItemWidthKey(targetItem) : getProviderWidthKey(providerId);
}

function getProviderAvailableCardWidth(count) {
  const viewportWidth =
    providerViewport?.getBoundingClientRect().width ||
    providerColumns.getBoundingClientRect().width ||
    schedulerPane.getBoundingClientRect().width ||
    0;
  return Math.max(1, viewportWidth - cardHandleWidth * Math.max(0, count - 1));
}

function distributePixelWidthsByRatio(items, availableWidth, baseResolver = getStoredItemWeight) {
  if (!items.length) return [];

  const minWidths = items.map(getItemMinimumWidth);
  const minTotal = minWidths.reduce((sum, width) => sum + width, 0);
  const remaining = Math.max(0, availableWidth - minTotal);
  const flexibleWidths = items.map((item, index) => {
    const baseWidth = Number(baseResolver(item, index));
    return Math.max(0, (Number.isFinite(baseWidth) && baseWidth > 0 ? baseWidth : 1) - minWidths[index]);
  });
  const flexibleTotal = flexibleWidths.reduce((sum, width) => sum + width, 0);

  return items.map((item, index) => {
    const extra = flexibleTotal > 0 ? remaining * (flexibleWidths[index] / flexibleTotal) : remaining / items.length;
    return minWidths[index] + extra;
  });
}

function restoreProviderWidthFromHiddenState(providerId, pageIndex, state) {
  const result = { limited: false };
  const allItems = getDisplayItems();
  const displayItems = usesManualPages() ? getPageDisplayItems(pageIndex, allItems) : allItems;
  const targetItem = displayItems.find((item) => itemContainsProvider(item, providerId));
  const key = getRestoredWidthKey(targetItem, providerId);
  if (Number.isFinite(state.weight) && state.weight > 0) {
    itemWidthWeights.set(key, state.weight);
  }

  if (!Number.isFinite(state.widthPx) || state.widthPx <= 0) return result;

  if (!targetItem || displayItems.length <= 1) {
    itemWidthWeights.set(key, 1);
    return result;
  }

  const availableWidth = getProviderAvailableCardWidth(displayItems.length);
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return result;

  const otherItems = displayItems.filter((item) => !itemContainsProvider(item, providerId));
  const otherMinWidth = otherItems.reduce((sum, item) => sum + getItemMinimumWidth(item), 0);
  const targetMinWidth = getItemMinimumWidth(targetItem);
  const maxRestorableWidth = Math.max(targetMinWidth, availableWidth - otherMinWidth);
  const targetWidth = clamp(state.widthPx, targetMinWidth, maxRestorableWidth);
  result.limited = targetWidth < state.widthPx - 1;
  const remainingWidth = Math.max(1, availableWidth - targetWidth);
  const otherWidths = distributePixelWidthsByRatio(otherItems, remainingWidth);
  itemWidthWeights.set(key, targetWidth);
  otherItems.forEach((item, index) => {
    itemWidthWeights.set(getItemWidthKey(item), otherWidths[index]);
  });

  return result;
}

function refitPageAfterCalendarRemoval(pageIndex) {
  if (!usesManualPages() || !Number.isInteger(pageIndex) || pageIndex < 0) return;

  const remainingProviderIds = new Set((pageLayouts[pageIndex] || []).filter((providerId) => activeProviderIds.has(providerId)));
  if (currentPageIndex === pageIndex && remainingProviderIds.size) {
    const cards = Array.from(providerColumns.querySelectorAll(".provider-card"));
    const remainingItems = currentVisibleItems.filter((item) =>
      getItemProviderIds(item).some((providerId) => remainingProviderIds.has(providerId)),
    );
    const nextWidths = distributePixelWidthsByRatio(
      remainingItems,
      getProviderAvailableCardWidth(remainingItems.length),
      (item) => {
        const visibleIndex = currentVisibleItems.indexOf(item);
        const domWidth = cards[visibleIndex]?.getBoundingClientRect().width;
        if (Number.isFinite(domWidth) && domWidth > 0) return domWidth;
        const weight = columnWeights[visibleIndex];
        return Number.isFinite(weight) && weight > 0 ? weight : getStoredItemWeight(item);
      },
    );

    remainingItems.forEach((item, index) => {
      itemWidthWeights.set(getItemWidthKey(item), nextWidths[index]);
    });
  }

  autoFitPageIndexes.delete(pageIndex);
  storeCardWeights();
}

function restoreMovedProviderWidths(widthStates, targetPageIndex) {
  if (!usesManualPages() || !(widthStates instanceof Map)) return;

  const limitedProviders = [];
  widthStates.forEach((state, providerId) => {
    if (!activeProviderIds.has(providerId)) return;
    const result = restoreProviderWidthFromHiddenState(providerId, targetPageIndex, state);
    if (result?.limited) {
      limitedProviders.push(providerId);
    }
  });

  autoFitPageIndexes.delete(targetPageIndex);
  storeCardWeights();

  if (limitedProviders.length) {
    const provider = getProviderById(limitedProviders[0]);
    showToast(`${provider?.name || "캘린더"}는 공간이 부족해 가능한 최대 폭으로 이동했습니다`);
  }
}

function applyReturningProviderWidthPolicy(providerId, pageIndex) {
  const state = hiddenWidthStates.get(providerId);
  if (!state) return;

  const restoreResult = restoreProviderWidthFromHiddenState(providerId, pageIndex, state);

  autoFitPageIndexes.delete(pageIndex);
  hiddenWidthStates.delete(providerId);
  storeCardWeights();

  if (restoreResult?.limited) {
    const provider = getProviderById(providerId);
    showToast(`${provider?.name || "캘린더"}는 공간이 부족해 가능한 최대 폭으로 복원했습니다`);
  }
}

function resetItemWeight(item) {
  const key = getItemWidthKey(item);
  if (key) {
    itemWidthWeights.delete(key);
  }
}

function resetPageItemWeights(pageIndex) {
  if (!usesManualPages()) return;
  getPageDisplayItems(pageIndex, getDisplayItems()).forEach(resetItemWeight);
  storeCardWeights();
}

function resetPagesItemWeights(pageIndexes) {
  Array.from(new Set(pageIndexes))
    .filter((pageIndex) => Number.isInteger(pageIndex) && pageIndex >= 0)
    .forEach(resetPageItemWeights);
}

function resetProviderWidthPreferences(providerIds) {
  const movingIds = new Set(providerIds.map(Number));
  if (!movingIds.size) return;

  Array.from(itemWidthWeights.keys()).forEach((key) => {
    const providerMatch = key.match(/:provider:(\d+)$/);
    if (providerMatch && movingIds.has(Number(providerMatch[1]))) {
      itemWidthWeights.delete(key);
      return;
    }

    const groupMatch = key.match(/:group:(.+)$/);
    if (!groupMatch) return;

    const group = calendarGroups.find((item) => item.id === groupMatch[1]);
    if (group?.providerIds.some((providerId) => movingIds.has(providerId))) {
      itemWidthWeights.delete(key);
    }
  });

  storeCardWeights();
}

function haveColumnKeysChanged(nextKeys) {
  return nextKeys.length !== columnWeightKeys.length || nextKeys.some((key, index) => key !== columnWeightKeys[index]);
}

function isPixelColumnWidthMode(weights = columnWeights) {
  return weights.some((weight) => Number.isFinite(weight) && weight >= 24);
}

function getColumnPixelWidth(index) {
  const item = currentVisibleItems[index];
  const width = columnWeights[index];
  return Math.max(getItemMinimumWidth(item), Number.isFinite(width) && width > 0 ? width : getStoredItemWeight(item));
}

function getPixelGridTotalWidth() {
  if (!isPixelColumnWidthMode() || !visibleCount) return null;

  const cardWidth = currentVisibleItems
    .slice(0, visibleCount)
    .reduce((sum, item, index) => sum + getColumnPixelWidth(index), 0);
  return cardWidth + cardHandleWidth * Math.max(0, visibleCount - 1);
}

function fitColumnWeightsToAvailableWidth() {
  if (!isPixelColumnWidthMode() || !visibleCount) return;

  const items = currentVisibleItems.slice(0, visibleCount);
  const availableWidth = getProviderAvailableCardWidth(items.length);
  const minimumWidth = items.reduce((sum, item) => sum + getItemMinimumWidth(item), 0);
  if (!Number.isFinite(availableWidth) || availableWidth <= 0 || minimumWidth > availableWidth + 0.5) return;

  const currentWidth = items.reduce((sum, item, index) => sum + getColumnPixelWidth(index), 0);
  if (Math.abs(currentWidth - availableWidth) < 1) return;

  columnWeights = distributePixelWidthsByRatio(items, availableWidth, (_item, index) => getColumnPixelWidth(index));
  columnWeightKeys = getCurrentColumnWeightKeys(visibleCount);
}

function ensureColumnWeights(count, reset = false, forceUniform = false) {
  const nextKeys = getCurrentColumnWeightKeys(count);
  if (forceUniform) {
    columnWeightKeys = nextKeys;
    columnWeights = Array.from({ length: count }, () => 1);
    return;
  }

  if (reset || columnWeights.length !== count || haveColumnKeysChanged(nextKeys)) {
    columnWeightKeys = nextKeys;
    columnWeights = currentVisibleItems.slice(0, count).map((item) => getStoredItemWeight(item));
  }
}

function rememberVisibleColumnWeights(options = {}) {
  columnWeightKeys = getCurrentColumnWeightKeys(visibleCount);
  currentVisibleItems.slice(0, visibleCount).forEach((item, index) => {
    const weight = columnWeights[index];
    if (Number.isFinite(weight) && weight > 0) {
      itemWidthWeights.set(getItemWidthKey(item), weight);
    }
  });

  if (options.persist !== false) {
    storeCardWeights();
  }
}

function resetVisibleColumnWeights() {
  getCurrentColumnWeightKeys(visibleCount).forEach((key) => itemWidthWeights.delete(key));
  columnWeights = Array.from({ length: visibleCount }, () => 1);
  columnWeightKeys = getCurrentColumnWeightKeys(visibleCount);
  storeCardWeights();
}

function seedGroupWidthFromAnchor(groupId, anchorProviderId) {
  const groupKey = `${viewMode}:group:${groupId}`;
  if (itemWidthWeights.has(groupKey)) return;

  const anchorProviderKey = `${viewMode}:provider:${anchorProviderId}`;
  const storedProviderWeight = itemWidthWeights.get(anchorProviderKey);
  if (Number.isFinite(storedProviderWeight) && storedProviderWeight > 0) {
    itemWidthWeights.set(groupKey, storedProviderWeight);
    storeCardWeights();
    return;
  }

  const anchorIndex = currentVisibleItems.findIndex((item) => itemContainsProvider(item, anchorProviderId));
  const visibleWeight = columnWeights[anchorIndex];
  if (Number.isFinite(visibleWeight) && visibleWeight > 0) {
    itemWidthWeights.set(groupKey, visibleWeight);
    storeCardWeights();
  }
}

function applyProviderGridColumns() {
  ensureColumnWeights(visibleCount);
  fitColumnWeightsToAvailableWidth();
  updateProviderColumnsScrollWidth();

  if (visibleCount <= 1) {
    const minColumn = getColumnMinWidth(0);
    providerColumns.style.gridTemplateColumns = `minmax(${minColumn}, 1fr)`;
    syncProviderHeaderColumnsStyle();
    refreshGroupTabDisplayModes();
    return;
  }

  providerColumns.style.gridTemplateColumns = currentVisibleItems
    .slice(0, visibleCount)
    .map((item, index) => {
      const cardColumn = isPixelColumnWidthMode()
        ? `${getColumnPixelWidth(index).toFixed(1)}px`
        : `minmax(${getColumnMinWidth(index)}, ${columnWeights[index].toFixed(3)}fr)`;
      return index === visibleCount - 1 ? cardColumn : `${cardColumn} 12px`;
    })
    .join(" ");
  syncProviderHeaderColumnsStyle();
  refreshGroupTabDisplayModes();
}

function applyProviderHorizontalScroll(scrollLeft = providerBottomScroll?.scrollLeft || 0) {
  providerColumns.style.transform = scrollLeft ? `translateX(${-scrollLeft}px)` : "";
  if (providerHeaderColumns) {
    providerHeaderColumns.style.transform = scrollLeft ? `translateX(${-scrollLeft}px)` : "";
  }
}

function syncProviderHeaderColumnsStyle() {
  if (!providerHeaderColumns) return;

  providerHeaderColumns.className = `provider-header-columns ${viewMode}-view`;
  providerHeaderColumns.style.gridTemplateColumns = providerColumns.style.gridTemplateColumns;
  providerHeaderColumns.style.minWidth = providerColumns.style.minWidth;
  providerHeaderColumns.style.width = providerColumns.style.width;
}

function renderProviderHeaderItem(item) {
  const headerCard = document.createElement("article");
  headerCard.className = "provider-header-card";

  if (item.type === "group") {
    const rememberedProviderId = activeGroupProviderIds.get(item.groupId);
    const selectedProviderInGroup = item.providers.find((provider) => provider.id === selectedProviderId);
    const activeProvider =
      item.providers.find((provider) => provider.id === rememberedProviderId) ||
      selectedProviderInGroup ||
      item.providers[0];

    headerCard.classList.add("is-group-card");
    headerCard.dataset.providerId = String(activeProvider.id);
    headerCard.dataset.groupId = item.groupId;
    headerCard.style.setProperty("--tab-count", item.providers.length);
    headerCard.classList.toggle("is-selected", Boolean(selectedProviderInGroup));
    headerCard.append(createGroupHeader(item.providers, item.groupId));
    return headerCard;
  }

  headerCard.dataset.providerId = String(item.provider.id);
  headerCard.classList.toggle("is-selected", item.provider.id === selectedProviderId);
  headerCard.append(createSingleHeader(item.provider));
  return headerCard;
}

function renderProviderHeaders() {
  if (!providerHeaderColumns) return;

  providerHeaderColumns.innerHTML = "";
  syncProviderHeaderColumnsStyle();

  currentVisibleItems.forEach((item, index) => {
    providerHeaderColumns.append(renderProviderHeaderItem(item));
    if (index < visibleCount - 1) {
      const gap = document.createElement("div");
      gap.className = "header-width-gap";
      providerHeaderColumns.append(gap);
    }
  });
}

function getDraggedPageIndex(event) {
  if (draggedPageIndex !== null) return draggedPageIndex;

  const raw = event.dataTransfer?.getData("text/plain") || "";
  if (!raw.startsWith("page:")) return null;

  const pageIndex = Number(raw.slice(5));
  return Number.isInteger(pageIndex) ? pageIndex : null;
}

function clearPageDropTargets() {
  pageIndicator.querySelectorAll(".page-chip.drop-target").forEach((chip) => {
    chip.classList.remove("drop-target");
  });
}

function shouldRenderPageDropQueue() {
  return usesManualPages() && (isPageEditMode || isCalendarDragPageCueVisible);
}

function closePageContextMenu() {
  if (activePageContextMenu) {
    activePageContextMenu.remove();
    activePageContextMenu = null;
  }
}

function deleteEmptyPage(pageIndex) {
  if ((pageLayouts[pageIndex] || []).length > 0) {
    showToast("캘린더가 있는 페이지는 삭제할 수 없습니다");
    return;
  }

  if (pageLayouts.length <= 1) {
    showToast("마지막 페이지는 삭제할 수 없습니다");
    return;
  }

  pageLayouts.splice(pageIndex, 1);
  currentPageIndex = clamp(currentPageIndex > pageIndex ? currentPageIndex - 1 : currentPageIndex, 0, pageLayouts.length - 1);
  syncCalendarOrderFromPageLayouts();
  storePageLayouts();
  closePageContextMenu();
  renderScheduler({ resetWeights: true });
  renderDoctorList();
  showToast(`${pageIndex + 1}페이지를 삭제했습니다`);
}

function openPageContextMenu(event, pageIndex) {
  closePageContextMenu();

  if ((pageLayouts[pageIndex] || []).length > 0) {
    openPageCalendarDialog(pageIndex);
    return;
  }

  const menu = document.createElement("div");
  menu.className = "page-context-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `${pageIndex + 1}페이지 메뉴`);

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.textContent = "캘린더 추가하기";
  addButton.addEventListener("click", () => {
    closePageContextMenu();
    openPageCalendarDialog(pageIndex);
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger";
  deleteButton.textContent = "페이지 삭제";
  deleteButton.addEventListener("click", () => deleteEmptyPage(pageIndex));

  menu.append(addButton, deleteButton);
  document.body.append(menu);
  const menuRect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - menuRect.width - 12)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - menuRect.height - 12)}px`;
  activePageContextMenu = menu;
}

function renderPageControls(allItems = getDisplayItems()) {
  pageIndicator.innerHTML = "";

  if (!usesManualPages()) {
    const totalPages = visibleCount > 0 ? Math.ceil(allItems.length / visibleCount) : 0;
    const page = totalPages > 0 ? Math.floor(firstVisibleIndex / visibleCount) + 1 : 0;
    pageIndicator.textContent = `${page} / ${totalPages}`;
    return { page, totalPages };
  }

  const page = pageLayouts.length ? currentPageIndex + 1 : 0;
  const totalPages = pageLayouts.length;
  if (!shouldRenderPageDropQueue()) {
    pageIndicator.textContent = `${page} / ${totalPages}`;
    return { page, totalPages };
  }

  const tray = document.createElement("div");
  tray.className = "page-tray";
  tray.classList.toggle("drag-page-cue", isCalendarDragPageCueVisible && !isPageEditMode);

  pageLayouts.forEach((page, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "page-chip";
    chip.draggable = isPageEditMode;
    chip.classList.toggle("active", index === currentPageIndex);
    chip.textContent = `${index + 1}`;
    chip.setAttribute("aria-label", `${index + 1}페이지`);
    chip.title = isPageEditMode
      ? "클릭하면 페이지 이동, 드래그하면 페이지 순서 변경, 우클릭하면 캘린더 추가"
      : "드래그 중인 캘린더를 이 페이지로 이동";
    chip.addEventListener("click", () => {
      if (isCalendarDragPageCueVisible && !isPageEditMode) return;
      currentPageIndex = index;
      renderScheduler({ resetWeights: true });
    });
    chip.addEventListener("contextmenu", (event) => {
      if (!isPageEditMode) return;
      event.preventDefault();
      openPageContextMenu(event, index);
    });
    chip.addEventListener("dragstart", (event) => {
      if (!isPageEditMode) {
        event.preventDefault();
        return;
      }
      event.stopPropagation();
      draggedPageIndex = index;
      draggedCardProviderId = null;
      chip.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `page:${index}`);
    });
    chip.addEventListener("dragend", () => {
      draggedPageIndex = null;
      chip.classList.remove("dragging");
      clearPageDropTargets();
    });
    chip.addEventListener("dragover", (event) => {
      const pageDragIndex = getDraggedPageIndex(event);
      if (!draggedCardProviderId && (pageDragIndex === null || !isPageEditMode)) return;
      event.preventDefault();
      chip.classList.add("drop-target");
      event.dataTransfer.dropEffect = "move";
    });
    chip.addEventListener("dragleave", () => {
      chip.classList.remove("drop-target");
    });
    chip.addEventListener("drop", (event) => {
      const pageDragIndex = getDraggedPageIndex(event);
      if (!draggedCardProviderId && (pageDragIndex === null || !isPageEditMode)) return;
      event.preventDefault();
      chip.classList.remove("drop-target");
      if (draggedCardProviderId) {
        moveCalendarUnitToPage(draggedCardProviderId, index, null, {
          stayOnCurrentPage: true,
        });
        return;
      }
      if (isPageEditMode) {
        reorderPageLayout(pageDragIndex, index);
      }
    });
    tray.append(chip);
  });

  if (isPageEditMode) {
    const addPage = document.createElement("button");
    addPage.type = "button";
    addPage.className = "page-chip add-page";
    addPage.textContent = "+";
    addPage.setAttribute("aria-label", "새 페이지를 만들거나 드래그한 캘린더를 새 페이지로 이동");
    addPage.addEventListener("click", () => {
      pageLayouts.push([]);
      currentPageIndex = pageLayouts.length - 1;
      storePageLayouts();
      renderScheduler({ resetWeights: true });
      showToast("빈 페이지를 추가했습니다. 캘린더 추가 버튼이나 드래그로 구성할 수 있습니다");
    });
    addPage.addEventListener("dragover", (event) => {
      if (!isPageEditMode || !draggedCardProviderId) return;
      event.preventDefault();
      addPage.classList.add("drop-target");
      event.dataTransfer.dropEffect = "move";
    });
    addPage.addEventListener("dragleave", () => {
      addPage.classList.remove("drop-target");
    });
    addPage.addEventListener("drop", (event) => {
      if (!isPageEditMode || !draggedCardProviderId) return;
      event.preventDefault();
      addPage.classList.remove("drop-target");
      moveCalendarUnitToPage(draggedCardProviderId, pageLayouts.length, null, {
        stayOnCurrentPage: true,
      });
    });
    tray.append(addPage);
  }

  pageIndicator.append(tray);
  return { page: currentPageIndex + 1, totalPages: pageLayouts.length };
}

function syncProviderBottomScrollbar() {
  if (!scheduleHorizontalBar || !providerBottomScroll || !providerBottomSpacer || !providerViewport) return;

  const fullWidth = Math.ceil(providerColumns.getBoundingClientRect().width);
  const viewportWidth = Math.ceil(providerViewport.getBoundingClientRect().width);
  const shouldShow = (viewMode === "max" || usesManualPages()) && fullWidth > viewportWidth + 1;

  scheduleHorizontalBar.hidden = !shouldShow;
  providerBottomSpacer.style.width = `${Math.max(fullWidth, viewportWidth)}px`;

  if (!shouldShow) {
    providerBottomScroll.scrollLeft = 0;
    applyProviderHorizontalScroll(0);
    return;
  }

  const maxScrollLeft = Math.max(0, fullWidth - viewportWidth);
  if (providerBottomScroll.scrollLeft > maxScrollLeft) {
    providerBottomScroll.scrollLeft = maxScrollLeft;
  }
  applyProviderHorizontalScroll(providerBottomScroll.scrollLeft);
}

function syncScheduleVerticalScrollbar() {
  if (!scheduleScroll || !scheduleVerticalScroll || !scheduleVerticalSpacer) return;

  const scrollHeight = Math.ceil(scheduleScroll.scrollHeight);
  const clientHeight = Math.ceil(scheduleScroll.clientHeight);
  const shouldShow = scrollHeight > clientHeight + 1;

  scheduleVerticalScroll.hidden = !shouldShow;
  scheduleVerticalSpacer.style.height = `${Math.max(scrollHeight, clientHeight)}px`;

  if (!shouldShow) {
    scheduleVerticalScroll.scrollTop = 0;
    scheduleScroll.scrollTop = 0;
    return;
  }

  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  if (scheduleScroll.scrollTop > maxScrollTop) {
    scheduleScroll.scrollTop = maxScrollTop;
  }

  if (Math.abs(scheduleVerticalScroll.scrollTop - scheduleScroll.scrollTop) > 1) {
    isSyncingVerticalScroll = true;
    scheduleVerticalScroll.scrollTop = scheduleScroll.scrollTop;
    isSyncingVerticalScroll = false;
  }
}

function updateProviderColumnsScrollWidth() {
  if ((!usesManualPages() && viewMode !== "max") || !currentVisibleItems.length) {
    providerColumns.style.minWidth = "";
    providerColumns.style.width = "";
    syncProviderHeaderColumnsStyle();
    requestAnimationFrame(syncProviderBottomScrollbar);
    requestAnimationFrame(syncScheduleVerticalScrollbar);
    return;
  }

  const minimumWidth = currentVisibleItems.reduce((sum, item, index) => {
    return sum + getItemMinimumWidth(item) + (index > 0 ? cardHandleWidth : 0);
  }, 0);
  const pixelGridWidth = getPixelGridTotalWidth();
  const fixedWidth = pixelGridWidth ? Math.max(minimumWidth, pixelGridWidth) : null;

  providerColumns.style.minWidth = `${minimumWidth}px`;
  providerColumns.style.width = fixedWidth ? `${fixedWidth}px` : "100%";
  syncProviderHeaderColumnsStyle();
  requestAnimationFrame(syncProviderBottomScrollbar);
  requestAnimationFrame(syncScheduleVerticalScrollbar);
}

function getColumnMinWidth(index) {
  const item = currentVisibleItems[index];
  if (item?.type === "group") {
    return `${getItemMinimumWidth(item)}px`;
  }

  return "var(--card-min)";
}

function updateGroupTabDisplayModes() {
  const compactThreshold = 72;

  document.querySelectorAll(".provider-card.is-group-card, .provider-header-card.is-group-card").forEach((card) => {
    const tabs = card.querySelector(".group-tabs");
    const tabCount = tabs?.querySelectorAll(".group-tab").length || 0;
    if (!tabs || !tabCount) {
      card.classList.remove("is-compact-tabs");
      return;
    }

    const perTabWidth = tabs.getBoundingClientRect().width / tabCount;
    card.classList.toggle("is-compact-tabs", perTabWidth <= compactThreshold);
  });
}

function refreshGroupTabDisplayModes() {
  updateGroupTabDisplayModes();
  requestAnimationFrame(updateGroupTabDisplayModes);
}

function getCollapsedWeight() {
  return viewMode === "max" ? 0.16 : 0.2;
}

function getVisibleCardPixelWidths(cards = Array.from(providerColumns.querySelectorAll(".provider-card"))) {
  return currentVisibleItems.slice(0, visibleCount).map((item, index) => {
    const width = cards[index]?.getBoundingClientRect().width;
    if (Number.isFinite(width) && width > 0) return width;
    return getColumnPixelWidth(index);
  });
}

function getRedistributedWeights(startWidths, handleIndex, deltaPx) {
  if (!deltaPx) return [...startWidths];

  const nextWidths = [...startWidths];
  const leftIndex = clamp(handleIndex, 0, Math.max(0, startWidths.length - 2));
  const rightIndex = leftIndex + 1;
  const leftMinWidth = getItemMinimumWidth(currentVisibleItems[leftIndex]);
  const rightMinWidth = getItemMinimumWidth(currentVisibleItems[rightIndex]);
  const leftStartWidth = Math.max(leftMinWidth, startWidths[leftIndex]);
  const rightStartWidth = Math.max(rightMinWidth, startWidths[rightIndex]);
  const effectiveDelta = clamp(deltaPx, leftMinWidth - leftStartWidth, rightStartWidth - rightMinWidth);

  nextWidths[leftIndex] = leftStartWidth + effectiveDelta;
  nextWidths[rightIndex] = rightStartWidth - effectiveDelta;
  return nextWidths;
}

function getPreferredSingleIndex(displayItems = getDisplayItems()) {
  if (!selectedProviderId) return 0;

  const selectedIndex = getSelectedDisplayIndex(displayItems);
  if (selectedIndex >= 0) return selectedIndex;

  return 0;
}

function setViewMode(nextMode, options = {}) {
  if (isPageEditMode && nextMode !== viewMode) {
    updateSortState();
    closeSortPopover();
    showToast("페이지 편집 중에는 정렬을 변경할 수 없습니다");
    return;
  }

  if (nextMode === "single" && viewMode !== "single") {
    previousNonSingleViewMode = viewMode;
  } else if (nextMode !== "single") {
    previousNonSingleViewMode = nextMode;
  }

  viewMode = nextMode;
  const displayItems = getDisplayItems();

  if (viewMode === "single") {
    firstVisibleIndex = getPreferredSingleIndex(displayItems);
    const singleItem = displayItems[firstVisibleIndex];
    if (singleItem && !itemContainsProvider(singleItem, selectedProviderId)) {
      selectedProviderId = getPrimaryProviderIdFromItem(singleItem);
    }
    updateCalendarField();
  }

  if (viewMode === "max") {
    firstVisibleIndex = 0;
  }

  if (isPageEditMode) {
    preparePageEditModeForCurrentView();
  }

  updatePageEditState();
  updateSortState();
  closeSortPopover();
  renderScheduler({ resetWeights: true, preserveVisibleCount: options.preserveVisibleCount });
}

function toggleSingleProvider(providerId) {
  selectedProviderId = providerId;

  if (viewMode === "single") {
    setViewMode(previousNonSingleViewMode);
    return;
  }

  setViewMode("single");
}

function getProviderInitial(provider) {
  return provider.name.slice(0, 1);
}

function createProviderChip(provider) {
  const chip = document.createElement("span");
  chip.className = "name-chip";
  chip.textContent = getProviderInitial(provider);
  chip.style.color = provider.color;
  chip.style.background = getChipColor(provider.color);
  return chip;
}

function createMenuButton(label, context) {
  const menu = document.createElement("button");
  menu.className = context.isTab ? "provider-menu tab-menu-button" : "provider-menu";
  menu.type = "button";
  menu.draggable = false;
  menu.setAttribute("aria-label", label);
  menu.textContent = "⋮";
  menu.addEventListener("pointerdown", (event) => event.stopPropagation());
  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    openCalendarActionMenu(menu, context);
  });
  return menu;
}

function trackDraggedCardPosition(event) {
  if (!draggedCardProviderId || !Number.isFinite(event.clientX)) return;
  if (event.clientX === 0 && event.clientY === 0) return;
  lastCardDragClientX = event.clientX;
  lastCardDragClientY = event.clientY;
}

function moveDraggedCardByEdge(providerId) {
  if (
    !isPageEditMode ||
    !providerId ||
    !Number.isFinite(lastCardDragClientX) ||
    !Number.isFinite(lastCardDragClientY)
  ) {
    return false;
  }

  const rect = schedulerPane.getBoundingClientRect();
  const threshold = 44;
  if (lastCardDragClientX < rect.left + threshold) {
    moveProviderToRelativePage(providerId, -1, { stayOnCurrentPage: true });
    return true;
  }
  if (lastCardDragClientX > rect.right - threshold) {
    moveProviderToRelativePage(providerId, 1, { stayOnCurrentPage: true });
    return true;
  }

  return false;
}

function createCalendarDragPreview(element, providerId) {
  const source =
    element.closest(".provider-card") ||
    providerColumns.querySelector(`.provider-card[data-provider-id="${providerId}"]`) ||
    element;
  const rect = source.getBoundingClientRect();
  const preview = source.cloneNode(true);

  preview.classList.add("calendar-drag-preview");
  preview.style.width = `${Math.max(160, rect.width)}px`;
  preview.style.height = `${Math.max(220, Math.min(rect.height, 520))}px`;
  preview.style.left = "-10000px";
  preview.style.top = "-10000px";
  document.body.append(preview);

  return { preview, rect };
}

function getProviderBodyCard(providerId) {
  return providerColumns.querySelector(`.provider-card[data-provider-id="${providerId}"]`);
}

function clearCalendarDropTargets() {
  document
    .querySelectorAll(
      ".provider-card.drop-target, .provider-card.drop-before, .provider-card.drop-after, .provider-header-card.drop-target, .provider-header-card.drop-before, .provider-header-card.drop-after",
    )
    .forEach((element) => {
      element.classList.remove("drop-target", "drop-before", "drop-after");
    });
}

function getCalendarDropPlacement(element, event) {
  const rect = element.getBoundingClientRect();
  const distanceToLeft = Math.abs(event.clientX - rect.left);
  const distanceToRight = Math.abs(rect.right - event.clientX);
  return distanceToLeft <= distanceToRight ? "before" : "after";
}

function setCalendarDropTarget(providerId, placement) {
  clearCalendarDropTargets();
  const className = placement === "after" ? "drop-after" : "drop-before";
  document
    .querySelectorAll(
      `.provider-card[data-provider-id="${providerId}"], .provider-header-card[data-provider-id="${providerId}"]`,
    )
    .forEach((element) => {
      element.classList.add("drop-target", className);
    });
}

function getBeforeProviderIdForDrop(targetProviderId, placement, movingProviderId) {
  const targetPageIndex = getProviderPageIndex(targetProviderId);
  const movingIds = new Set(getMovablePageProviderIds(movingProviderId));
  const pageProviderIds = (pageLayouts[targetPageIndex] || []).filter((providerId) => !movingIds.has(providerId));
  const pageItems = getPageDisplayItems(targetPageIndex, getDisplayItems()).filter((item) => {
    return !getItemProviderIds(item).some((providerId) => movingIds.has(providerId));
  });
  const targetItem = getDisplayItemByProviderId(pageItems, targetProviderId);
  const targetIds = getItemProviderIds(targetItem).filter((providerId) => pageProviderIds.includes(providerId));
  if (!targetIds.length) return placement === "after" ? null : targetProviderId;

  if (placement !== "after") return targetIds[0];

  const lastTargetIndex = Math.max(...targetIds.map((providerId) => pageProviderIds.indexOf(providerId)));
  if (lastTargetIndex < 0) return null;

  return pageProviderIds[lastTargetIndex + 1] || null;
}

function reorderStandaloneCardByPlacement(sourceProviderId, targetProviderId, placement) {
  if (!sourceProviderId || sourceProviderId === targetProviderId) return;
  if (findGroupByProvider(sourceProviderId) || findGroupByProvider(targetProviderId)) return;

  const sourceIndex = calendarOrder.indexOf(sourceProviderId);
  const targetIndex = calendarOrder.indexOf(targetProviderId);
  if (sourceIndex < 0 || targetIndex < 0) return;

  const nextOrder = [...calendarOrder];
  const [movedId] = nextOrder.splice(sourceIndex, 1);
  const adjustedTargetIndex = nextOrder.indexOf(targetProviderId);
  nextOrder.splice(placement === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex, 0, movedId);
  calendarOrder = nextOrder;
  renderScheduler({ preserveVisibleCount: true, alignPage: false });
}

function moveCalendarUnitToProviderDropTarget(sourceProviderId, targetProviderId, placement) {
  if (usesManualPages()) {
    moveCalendarUnitToPage(
      sourceProviderId,
      getProviderPageIndex(targetProviderId),
      getBeforeProviderIdForDrop(targetProviderId, placement, sourceProviderId),
      { silent: true },
    );
    showToast("캘린더 위치를 변경했습니다");
    return;
  }

  reorderStandaloneCardByPlacement(sourceProviderId, targetProviderId, placement);
  showToast("캘린더 위치를 변경했습니다");
}

function getTargetProviderIdForHeader(provider) {
  if (!provider) return null;
  const group = findGroupByProvider(provider.id);
  return group?.providerIds.find((providerId) => activeProviderIds.has(providerId)) || provider.id;
}

function getTargetProviderIdForCard(card, fallbackProviderId) {
  const providerId = Number(card.dataset.providerId) || fallbackProviderId;
  const provider = getProviderById(providerId);
  return getTargetProviderIdForHeader(provider) || providerId;
}

function applyCalendarDropCue(event, targetElement, targetProviderId) {
  if (!draggedCardProviderId || draggedCardProviderId === targetProviderId) return false;

  event.preventDefault();
  const placement = getCalendarDropPlacement(targetElement, event);
  setCalendarDropTarget(targetProviderId, placement);
  event.dataTransfer.dropEffect = "move";
  return true;
}

function applyCalendarDrop(event, targetElement, targetProviderId) {
  if (!draggedCardProviderId || draggedCardProviderId === targetProviderId) return false;

  event.preventDefault();
  const placement = getCalendarDropPlacement(targetElement, event);
  clearCalendarDropTargets();
  moveCalendarUnitToProviderDropTarget(draggedCardProviderId, targetProviderId, placement);
  return true;
}

function beginCalendarCardDrag(event, providerId, element) {
  event.stopPropagation();
  draggedCardProviderId = providerId;
  isCalendarDragPageCueVisible = usesManualPages();
  lastCardDragClientX = event.clientX;
  lastCardDragClientY = event.clientY;
  element.classList.add("dragging");
  element.closest(".provider-header-card")?.classList.add("dragging");
  getProviderBodyCard(providerId)?.classList.add("dragging-card");
  providerColumns.classList.add("is-dragging-cards");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(providerId));

  const { preview, rect } = createCalendarDragPreview(element, providerId);
  const offsetX = clamp(event.clientX - rect.left, 20, Math.max(20, rect.width - 20));
  const offsetY = clamp(event.clientY - rect.top, 18, 54);
  event.dataTransfer.setDragImage(preview, offsetX, offsetY);
  renderPageControls();
  requestAnimationFrame(() => preview.remove());
}

function endCalendarCardDrag(element) {
  const providerId = draggedCardProviderId;
  element.classList.remove("dragging", "dragging-card", "drop-target");
  document.querySelectorAll(".provider-card.dragging-card, .provider-header-card.dragging").forEach((target) => {
    target.classList.remove("dragging-card", "dragging");
  });
  clearCalendarDropTargets();
  if (providerId) {
    moveDraggedCardByEdge(providerId);
  }
  draggedCardProviderId = null;
  isCalendarDragPageCueVisible = false;
  lastCardDragClientX = null;
  lastCardDragClientY = null;
  cardDragEdgeDirection = 0;
  clearTimeout(cardDragEdgeTimer);
  providerColumns.classList.remove("is-dragging-cards");
  renderPageControls();
}

function enableWholeCardDrag(card, providerId) {
  card.draggable = false;
  card.title = isPageEditMode
    ? "상단 의사명 영역을 드래그하면 페이지나 위치를 변경할 수 있습니다"
    : "상단 의사명 영역을 드래그하면 현재 페이지 안에서 위치를 변경할 수 있습니다";

  card.addEventListener("dragover", (event) => {
    const targetProviderId = getTargetProviderIdForCard(card, providerId);
    applyCalendarDropCue(event, card, targetProviderId);
  });

  card.addEventListener("dragleave", (event) => {
    if (event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) return;
    clearCalendarDropTargets();
  });

  card.addEventListener("drop", (event) => {
    const targetProviderId = getTargetProviderIdForCard(card, providerId);
    applyCalendarDrop(event, card, targetProviderId);
  });
}

function createSingleHeader(provider) {
  const header = document.createElement("header");
  header.className = "single-header";
  header.draggable = true;
  header.dataset.providerId = String(provider.id);
  const name = document.createElement("div");
  name.className = "provider-name";

  const label = document.createElement("span");
  label.textContent = getProviderLabel(provider);

  name.append(createProviderChip(provider), label);
  name.title = "더블클릭하면 이 캘린더만 봅니다";
  name.addEventListener("dblclick", () => {
    toggleSingleProvider(provider.id);
  });

  header.addEventListener("dragstart", (event) => {
    if (event.target.closest(".provider-menu, .tab-menu-button, button, select, input, textarea")) {
      event.preventDefault();
      return;
    }
    beginCalendarCardDrag(event, provider.id, header);
  });

  header.addEventListener("drag", trackDraggedCardPosition);

  header.addEventListener("dragend", () => {
    endCalendarCardDrag(header);
  });

  header.addEventListener("dragover", (event) => {
    const targetProviderId = getTargetProviderIdForHeader(provider);
    const targetElement = header.closest(".provider-header-card") || header;
    applyCalendarDropCue(event, targetElement, targetProviderId);
  });

  header.addEventListener("dragleave", () => {
    clearCalendarDropTargets();
  });

  header.addEventListener("drop", (event) => {
    const targetProviderId = getTargetProviderIdForHeader(provider);
    const targetElement = header.closest(".provider-header-card") || header;
    applyCalendarDrop(event, targetElement, targetProviderId);
  });

  header.append(
    name,
    createMenuButton(`${provider.name} 더보기`, { type: "provider", providerId: provider.id, isTab: false }),
  );
  return header;
}

function createGroupTab(provider, groupId) {
  const tab = document.createElement("div");
  tab.className = "group-tab";
  tab.draggable = true;
  tab.dataset.providerId = String(provider.id);
  tab.dataset.groupId = groupId;
  tab.classList.toggle("active", provider.id === activeGroupProviderIds.get(groupId));
  tab.title = `${provider.name} 드래그로 순서 변경`;

  const label = document.createElement("button");
  label.type = "button";
  label.className = "group-tab-label";
  label.draggable = false;
  label.append(createProviderChip(provider));

  const name = document.createElement("span");
  name.className = "tab-name";
  name.textContent = getProviderLabel(provider);
  label.append(name);
  label.addEventListener("click", (event) => {
    if (event.detail > 1) return;
    clearTimeout(tabClickTimer);
    tabClickTimer = setTimeout(() => {
      activeGroupProviderIds.set(groupId, provider.id);
      selectedProviderId = provider.id;
      updateCalendarField();
      renderScheduler({ preserveVisibleCount: true, alignPage: false });
    }, 180);
  });
  label.addEventListener("dblclick", () => {
    clearTimeout(tabClickTimer);
    activeGroupProviderIds.set(groupId, provider.id);
    selectedProviderId = provider.id;
    toggleSingleProvider(provider.id);
  });

  tab.addEventListener("dragstart", (event) => {
    draggedTabProviderId = provider.id;
    tab.classList.add("dragging");
    providerColumns.classList.add("is-dragging-tabs");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(provider.id));
  });

  tab.addEventListener("dragend", () => {
    draggedTabProviderId = null;
    tab.classList.remove("dragging");
    providerColumns.classList.remove("is-dragging-tabs");
  });

  tab.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });

  tab.addEventListener("drop", (event) => {
    event.preventDefault();
    const targetProviderId = provider.id;
    reorderGroupTab(draggedTabProviderId, targetProviderId);
  });

  tab.append(
    label,
    createMenuButton(`${provider.name} 탭 더보기`, { type: "group-tab", providerId: provider.id, isTab: true }),
  );
  return tab;
}

function createGroupHeader(groupProviders, groupId) {
  const header = document.createElement("header");
  header.className = "group-header";
  const tabs = document.createElement("div");
  tabs.className = "group-tabs";
  tabs.style.setProperty("--tab-count", groupProviders.length);
  groupProviders.forEach((provider) => tabs.append(createGroupTab(provider, groupId)));
  header.append(tabs);
  return header;
}

function createSlotBody(providerId, isSelectedCard) {
  const body = document.createElement("div");
  body.className = "slot-body";
  body.dataset.providerId = String(providerId);
  body.style.setProperty("--busy-start", fixedBusyStartSlot);

  const busyBlock = document.createElement("div");
  busyBlock.className = "busy-block";
  busyBlock.setAttribute("aria-hidden", "true");

  body.append(busyBlock);

  const provider = getProviderById(providerId);
  times.forEach((time, index) => {
    const row = document.createElement("div");
    row.className = "slot-row";
    row.dataset.slotIndex = String(index);
    row.role = "button";
    row.tabIndex = -1;
    row.setAttribute("aria-label", `${provider?.name || "캘린더"} ${time.label} 예약 선택`);
    row.addEventListener("pointerdown", (event) => {
      if (isPageEditMode) return;
      beginSlotSelection(event, index, providerId);
    });
    body.append(row);
  });

  if (isSelectedCard) {
    body.append(createSelectionBox());
  }

  if (providerId % 9 === 0) {
    const appointment = document.createElement("button");
    appointment.type = "button";
    appointment.className = "appointment-block is-dim";
    appointment.style.top = `calc(var(--slot-h) * ${Math.max(4, fixedBusyStartSlot - 6)} + 5px)`;
    appointment.textContent = "진료 대기";
    body.append(appointment);
  }

  return body;
}

function renderProviderCard(provider) {
  const card = document.createElement("article");
  card.className = "provider-card";
  card.dataset.providerId = String(provider.id);
  if (provider.id === selectedProviderId) {
    card.classList.add("is-selected");
  }

  enableWholeCardDrag(card, provider.id);
  card.append(createSingleHeader(provider), createSlotBody(provider.id, provider.id === selectedProviderId));
  return card;
}

function renderGroupCard(groupProviders, groupId) {
  const rememberedProviderId = activeGroupProviderIds.get(groupId);
  const selectedProviderInGroup = groupProviders.find((provider) => provider.id === selectedProviderId);
  const activeProvider =
    groupProviders.find((provider) => provider.id === rememberedProviderId) ||
    selectedProviderInGroup ||
    groupProviders[0];
  const isSelectedCard = Boolean(selectedProviderInGroup);

  activeGroupProviderIds.set(groupId, activeProvider.id);

  const card = document.createElement("article");
  card.className = "provider-card is-group-card";
  card.dataset.providerId = String(activeProvider.id);
  card.dataset.groupId = groupId;
  card.style.setProperty("--tab-count", groupProviders.length);
  card.classList.toggle("is-selected", isSelectedCard);
  enableWholeCardDrag(card, activeProvider.id);
  card.append(createGroupHeader(groupProviders, groupId), createSlotBody(activeProvider.id, isSelectedCard));
  return card;
}

function renderCalendarItem(item) {
  return item.type === "group" ? renderGroupCard(item.providers, item.groupId) : renderProviderCard(item.provider);
}

function createActionButton(label, action, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (options.tone) {
    button.dataset.tone = options.tone;
  }
  button.addEventListener("click", () => {
    action();
  });
  return button;
}

function showToast(message) {
  clearTimeout(toastTimer);
  document.querySelector(".toast-message")?.remove();

  const toast = document.createElement("div");
  toast.className = "toast-message";
  toast.textContent = message;
  document.body.append(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 180);
  }, 1800);
}

function areWeightsEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => Math.abs(value - b[index]) < 0.001);
}

function showResizeLimitFeedback(handle) {
  clearTimeout(resizeLimitFeedbackTimer);
  handle.classList.add("is-limited");

  const now = Date.now();
  if (now - lastResizeLimitToastAt > 1600) {
    lastResizeLimitToastAt = now;
    showToast("현재 보이는 카드 수를 유지합니다. 최소 폭에 도달했습니다");
  }

  resizeLimitFeedbackTimer = setTimeout(() => {
    handle.classList.remove("is-limited");
  }, 520);
}

function focusMergedGroup(groupId) {
  clearTimeout(mergeFocusTimer);
  const card = providerColumns.querySelector(`[data-group-id="${groupId}"]`);
  if (!card) return;

  card.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  card.classList.remove("is-merge-focus");
  requestAnimationFrame(() => {
    card.classList.add("is-merge-focus");
  });

  mergeFocusTimer = setTimeout(() => {
    card.classList.remove("is-merge-focus");
  }, 2400);
}

function closeCalendarActionMenu() {
  if (activeActionMenu) {
    activeActionMenu.remove();
    activeActionMenu = null;
  }
}

function openCalendarActionMenu(anchor, context) {
  closeCalendarActionMenu();

  const menu = document.createElement("div");
  menu.className = "calendar-action-menu";
  const actions = [
    createActionButton("캘린더 합치기", () => openMergeDialog(context.providerId, context)),
    createActionButton("분리하기", () => splitProviderFromGroup(context.providerId)),
    createActionButton("전체 분리하기", () => splitAllCalendars(context.providerId)),
  ];

  actions.push(
    createActionButton("예약자 목록 출력  ›", () => {
      closeCalendarActionMenu();
      showToast("예약자 목록 출력을 할 수 없습니다");
    }),
  );

  menu.append(...actions);

  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.left, window.innerWidth - menuRect.width - 12)}px`;
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - menuRect.height - 12)}px`;
  activeActionMenu = menu;
}

function getAnchorSlotIndex(anchorProviderId) {
  const index = currentVisibleItems.findIndex((item) => itemContainsProvider(item, anchorProviderId));
  return index >= 0 ? index : 0;
}

function getCurrentMergeSelection(anchorProviderId, context = {}) {
  const group = findGroupByProvider(anchorProviderId);
  if (group && context.type === "group-tab") return group.providerIds;

  return [anchorProviderId];
}

function removeProviderFromGroups(providerId, exceptGroupId = null) {
  calendarGroups.forEach((group) => {
    if (group.id !== exceptGroupId) {
      group.providerIds = group.providerIds.filter((id) => id !== providerId);
    }
  });
  removeEmptyCalendarGroups(exceptGroupId);
}

function getOrCreateAnchorGroup(anchorProviderId) {
  let group = findGroupByProvider(anchorProviderId);
  if (!group) {
    group = { id: createGroupId(), providerIds: [anchorProviderId] };
    calendarGroups.push(group);
  }
  return group;
}

function mergeCalendarsAtAnchor(selectedIds, anchorProviderId, anchorSlotIndex) {
  const previousOrder = [...calendarOrder];
  const previousItems = getDisplayItems();
  const anchorDisplayIndex = previousItems.findIndex((item) => itemContainsProvider(item, anchorProviderId));
  const manualAnchorPageIndex = usesManualPages() ? getProviderPageIndex(anchorProviderId) : null;
  const manualDesiredItemCount =
    manualAnchorPageIndex !== null ? getPageItemCount(manualAnchorPageIndex, previousItems) : 0;
  const activeIds = new Set(getActiveProviders().map((provider) => provider.id));
  const uniqueIds = [];

  [anchorProviderId, ...selectedIds].forEach((providerId) => {
    if (activeIds.has(providerId) && !uniqueIds.includes(providerId)) {
      uniqueIds.push(providerId);
    }
  });

  const providerIds = uniqueIds;
  if (providerIds.length < 2) {
    showToast("합칠 캘린더를 2개 이상 선택해주세요");
    return false;
  }

  const selectedSet = new Set(providerIds);
  const existingAnchorGroup = findGroupByProvider(anchorProviderId);
  const anchorGroupId = existingAnchorGroup?.id || createGroupId();
  const nextGroups = [];

  const displayUnits = [];
  let insertedAnchorGroup = false;
  previousItems.forEach((item) => {
    const itemIds = getItemProviderIds(item).filter((providerId) => activeIds.has(providerId));

    if (itemIds.includes(anchorProviderId)) {
      displayUnits.push(providerIds);
      insertedAnchorGroup = true;
      const remainingAnchorItemIds = itemIds.filter((providerId) => !selectedSet.has(providerId));
      if (item.type === "group" && remainingAnchorItemIds.length >= 2) {
        const remainingGroupId = item.groupId === anchorGroupId ? createGroupId() : item.groupId;
        nextGroups.push({ id: remainingGroupId, providerIds: remainingAnchorItemIds });
        displayUnits.push(remainingAnchorItemIds);
      } else {
        remainingAnchorItemIds.forEach((providerId) => displayUnits.push([providerId]));
      }
      return;
    }

    const remainingIds = itemIds.filter((providerId) => !selectedSet.has(providerId));
    if (!remainingIds.length) return;

    if (item.type === "group" && remainingIds.length >= 2) {
      nextGroups.push({ id: item.groupId, providerIds: remainingIds });
      displayUnits.push(remainingIds);
    } else {
      remainingIds.forEach((providerId) => displayUnits.push([providerId]));
    }
  });

  if (!insertedAnchorGroup) {
    displayUnits.splice(clamp(anchorDisplayIndex, 0, displayUnits.length), 0, providerIds);
  }

  nextGroups.push({ id: anchorGroupId, providerIds });
  calendarGroups = nextGroups;
  seedGroupWidthFromAnchor(anchorGroupId, anchorProviderId);

  const nextActiveOrder = displayUnits.flat();
  calendarOrder = [...nextActiveOrder, ...previousOrder.filter((providerId) => !nextActiveOrder.includes(providerId))];
  placeProvidersOnAnchorPage(providerIds, anchorProviderId);
  if (manualAnchorPageIndex !== null) {
    fillManualPageFromFollowing(manualAnchorPageIndex, manualDesiredItemCount);
    currentPageIndex = getProviderPageIndex(anchorProviderId);
  }
  selectedProviderId = anchorProviderId;
  activeGroupProviderIds.set(anchorGroupId, anchorProviderId);

  const validGroupIds = new Set(calendarGroups.map((group) => group.id));
  Array.from(activeGroupProviderIds.keys()).forEach((groupId) => {
    if (!validGroupIds.has(groupId)) {
      activeGroupProviderIds.delete(groupId);
    }
  });

  const groupIndex = getDisplayItems().findIndex((item) => item.groupId === anchorGroupId);
  firstVisibleIndex = Math.max(0, groupIndex - anchorSlotIndex);
  return anchorGroupId;
}

function reorderGroupTab(sourceProviderId, targetProviderId) {
  if (!sourceProviderId || sourceProviderId === targetProviderId) return;

  const group = findGroupByProvider(sourceProviderId);
  if (!group || !group.providerIds.includes(targetProviderId)) return;

  const sourceIndex = group.providerIds.indexOf(sourceProviderId);
  const targetIndex = group.providerIds.indexOf(targetProviderId);
  if (sourceIndex < 0 || targetIndex < 0) return;

  const nextIds = [...group.providerIds];
  const [movedId] = nextIds.splice(sourceIndex, 1);
  nextIds.splice(targetIndex, 0, movedId);
  group.providerIds = nextIds;
  activeGroupProviderIds.set(group.id, activeGroupProviderIds.get(group.id) || nextIds[0]);
  const groupSet = new Set(nextIds);
  const firstGroupIndex = calendarOrder.findIndex((providerId) => groupSet.has(providerId));
  const remainingOrder = calendarOrder.filter((providerId) => !groupSet.has(providerId));
  calendarOrder = [
    ...remainingOrder.slice(0, firstGroupIndex),
    ...nextIds,
    ...remainingOrder.slice(firstGroupIndex),
  ];
  renderScheduler({ preserveVisibleCount: true, alignPage: false });
}

function reorderStandaloneCard(sourceProviderId, targetProviderId) {
  if (!sourceProviderId || sourceProviderId === targetProviderId) return;
  if (findGroupByProvider(sourceProviderId) || findGroupByProvider(targetProviderId)) return;

  if (usesManualPages()) {
    const targetPageIndex = getProviderPageIndex(targetProviderId);
    moveProviderToPage(sourceProviderId, targetPageIndex, targetProviderId, { silent: true });
    showToast("캘린더 위치를 변경했습니다");
    return;
  }

  const sourceIndex = calendarOrder.indexOf(sourceProviderId);
  const targetIndex = calendarOrder.indexOf(targetProviderId);
  if (sourceIndex < 0 || targetIndex < 0) return;

  const nextOrder = [...calendarOrder];
  const [movedId] = nextOrder.splice(sourceIndex, 1);
  const adjustedTargetIndex = nextOrder.indexOf(targetProviderId);
  nextOrder.splice(adjustedTargetIndex, 0, movedId);
  calendarOrder = nextOrder;
  renderScheduler({ preserveVisibleCount: true, alignPage: false });
}

function splitProviderFromGroup(providerId) {
  closeCalendarActionMenu();
  const group = findGroupByProvider(providerId);
  if (!group) {
    showToast("분리할 캘린더가 없습니다");
    return;
  }

  const remainingGroupIds = group.providerIds.filter((id) => id !== providerId);
  calendarOrder = calendarOrder.filter((id) => id !== providerId);
  const firstGroupIndex = calendarOrder.findIndex((id) => remainingGroupIds.includes(id));
  const insertIndex = firstGroupIndex >= 0 ? firstGroupIndex + remainingGroupIds.length : calendarOrder.length;
  calendarOrder.splice(insertIndex, 0, providerId);

  group.providerIds = remainingGroupIds;
  if (group.providerIds.length < 2) {
    calendarGroups = calendarGroups.filter((candidate) => candidate.id !== group.id);
    activeGroupProviderIds.delete(group.id);
  } else if (!group.providerIds.includes(activeGroupProviderIds.get(group.id))) {
    activeGroupProviderIds.set(group.id, group.providerIds[0]);
  }

  selectedProviderId = providerId;
  renderScheduler({ resetWeights: true, alignPage: false });
}

function splitAllCalendars(providerId) {
  closeCalendarActionMenu();
  const group = findGroupByProvider(providerId);
  if (!group) {
    showToast("전체 분리할 캘린더가 없습니다");
    return;
  }

  calendarGroups = calendarGroups.filter((candidate) => candidate.id !== group.id);
  activeGroupProviderIds.delete(group.id);
  renderScheduler({ resetWeights: true });
}

function openMergeDialog(anchorProviderId, context = {}) {
  closeCalendarActionMenu();
  document.querySelector(".merge-dialog-backdrop")?.remove();

  const activeProviders = getActiveProviders();
  const anchorSlotIndex = getAnchorSlotIndex(anchorProviderId);
  const existingSelection = new Set(getCurrentMergeSelection(anchorProviderId, context));
  const backdrop = document.createElement("div");
  backdrop.className = "merge-dialog-backdrop";

  const dialog = document.createElement("section");
  dialog.className = "merge-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "캘린더 합치기");

  const title = document.createElement("h2");
  title.textContent = "합쳐 보기 원하는 캘린더를 선택해주세요.";

  const list = document.createElement("div");
  list.className = "merge-list";

  activeProviders.forEach((provider) => {
    const row = document.createElement("label");
    row.className = "merge-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = String(provider.id);
    checkbox.checked = existingSelection.has(provider.id);
    if (provider.id === anchorProviderId) {
      checkbox.checked = true;
      checkbox.disabled = true;
    }
    const text = document.createElement("span");
    text.textContent = provider.name;
    row.append(checkbox, text);
    list.append(row);
  });

  const actions = document.createElement("div");
  actions.className = "merge-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ghost";
  cancel.textContent = "취소";
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "primary";
  confirm.textContent = "확인";

  const getCheckedIds = () =>
    Array.from(list.querySelectorAll("input"))
      .filter((checkbox) => checkbox.checked || checkbox.disabled)
      .map((checkbox) => Number(checkbox.value));
  const syncConfirmState = () => {
    confirm.disabled = getCheckedIds().length < 2;
  };
  const applyMergeSelection = (options = {}) => {
    const selectedIds = getCheckedIds();
    if (selectedIds.length < 2) {
      syncConfirmState();
      return false;
    }

    const desiredVisibleCount = visibleCount;
    const mergedGroupId = mergeCalendarsAtAnchor(selectedIds, anchorProviderId, anchorSlotIndex);
    if (!mergedGroupId) return false;

    renderScheduler({ alignPage: false, anchorSlotIndex, desiredVisibleCount });
    focusMergedGroup(mergedGroupId);
    showToast("선택한 캘린더가 하나의 카드에 탭으로 합쳐졌습니다");
    if (options.close) {
      backdrop.remove();
    }
    return true;
  };

  list.addEventListener("change", (event) => {
    const checkbox = event.target.closest("input");
    if (!checkbox) return;

    syncConfirmState();
  });

  cancel.addEventListener("click", () => backdrop.remove());
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) backdrop.remove();
  });
  confirm.addEventListener("click", () => {
    applyMergeSelection({ close: true });
  });

  actions.append(cancel, confirm);
  dialog.append(title, list, actions);
  backdrop.append(dialog);
  document.body.append(backdrop);
  syncConfirmState();
}

function openPageCalendarDialog(targetPageIndex) {
  closeCalendarActionMenu();
  document.querySelector(".merge-dialog-backdrop")?.remove();

  const pageIds = new Set(pageLayouts[targetPageIndex] || []);
  const backdrop = document.createElement("div");
  backdrop.className = "merge-dialog-backdrop";

  const dialog = document.createElement("section");
  dialog.className = "merge-dialog page-calendar-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", `${targetPageIndex + 1}페이지 캘린더 추가`);

  const title = document.createElement("h2");
  title.textContent = `${targetPageIndex + 1}페이지에 추가할 캘린더를 선택해주세요.`;

  const list = document.createElement("div");
  list.className = "merge-list";

  providers.forEach((provider) => {
    const row = document.createElement("label");
    row.className = "merge-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = String(provider.id);
    checkbox.checked = pageIds.has(provider.id);
    checkbox.disabled = pageIds.has(provider.id);
    row.classList.toggle("is-disabled", checkbox.disabled);

    const text = document.createElement("span");
    text.textContent = provider.name;
    row.append(checkbox, text);
    list.append(row);
  });

  const actions = document.createElement("div");
  actions.className = "merge-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ghost";
  cancel.textContent = "취소";
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "primary";
  confirm.textContent = "확인";

  const getSelectedIds = () =>
    Array.from(list.querySelectorAll("input:not(:disabled)"))
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => Number(checkbox.value));
  const syncConfirmState = () => {
    confirm.disabled = getSelectedIds().length === 0;
  };

  list.addEventListener("change", syncConfirmState);
  cancel.addEventListener("click", () => backdrop.remove());
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) backdrop.remove();
  });
  confirm.addEventListener("click", () => {
    const selectedIds = getSelectedIds();
    if (!selectedIds.length) {
      syncConfirmState();
      return;
    }

    selectedIds.forEach((providerId) => activeProviderIds.add(providerId));
    const detachedIds = selectedIds.filter((providerId) => findGroupByProvider(providerId));
    detachedIds.forEach((providerId) => removeProviderFromGroups(providerId));
    moveProvidersToPage(selectedIds, targetPageIndex, null, {
      stayOnCurrentPage: true,
      message: detachedIds.length
        ? `${targetPageIndex + 1}페이지에 선택한 탭 캘린더를 독립 카드로 추가했습니다`
        : `${targetPageIndex + 1}페이지에 캘린더를 추가했습니다`,
    });
    renderDoctorList();
    backdrop.remove();
  });

  actions.append(cancel, confirm);
  dialog.append(title, list, actions);
  backdrop.append(dialog);
  document.body.append(backdrop);
  syncConfirmState();
}

function createCardResizeHandle(leftIndex) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "card-width-handle";
  handle.dataset.cardResizeIndex = String(leftIndex);
  handle.setAttribute("aria-label", "인접한 캘린더 카드 폭 조정");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("role", "separator");

  handle.addEventListener("pointerdown", (event) => {
    const index = Number(handle.dataset.cardResizeIndex);
    const cards = Array.from(providerColumns.querySelectorAll(".provider-card"));
    if (!cards[index] || !cards[index + 1]) return;

    const startX = event.clientX;
    const startWeights = getVisibleCardPixelWidths(cards);
    let didResize = false;

    handle.setPointerCapture(event.pointerId);
    handle.classList.add("active");

    const onMove = (moveEvent) => {
      const nextWeights = getRedistributedWeights(startWeights, index, moveEvent.clientX - startX);
      if (Math.abs(moveEvent.clientX - startX) > 4 && areWeightsEqual(nextWeights, columnWeights)) {
        showResizeLimitFeedback(handle);
        return;
      }

      handle.classList.remove("is-limited");
      columnWeights = nextWeights;
      didResize = true;
      rememberVisibleColumnWeights({ persist: false });
      applyProviderGridColumns();
    };

    const onEnd = () => {
      handle.classList.remove("active", "is-limited");
      if (didResize) {
        markCurrentPageWidthsTouched();
      }
      rememberVisibleColumnWeights();
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  });

  handle.addEventListener("dblclick", () => {
    markCurrentPageWidthsTouched();
    resetVisibleColumnWeights();
    applyProviderGridColumns();
  });

  handle.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    const index = Number(handle.dataset.cardResizeIndex);

    if (event.key === "Home" || event.key === "End") {
      markCurrentPageWidthsTouched();
      resetVisibleColumnWeights();
    } else {
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const virtualDelta = direction * (event.shiftKey ? 96 : 48);
      const nextWeights = getRedistributedWeights(getVisibleCardPixelWidths(), index, virtualDelta);
      if (areWeightsEqual(nextWeights, columnWeights)) {
        showResizeLimitFeedback(handle);
        return;
      }

      handle.classList.remove("is-limited");
      columnWeights = nextWeights;
      markCurrentPageWidthsTouched();
      rememberVisibleColumnWeights();
    }

    applyProviderGridColumns();
  });

  return handle;
}

function createSelectionBox() {
  const box = document.createElement("div");
  box.className = "selection-box";
  box.setAttribute("aria-hidden", "true");
  syncSelectionBox(box);
  return box;
}

function getSelectionRange() {
  const start = Math.min(selectedSlot, selectionEndSlot);
  const end = Math.max(selectedSlot, selectionEndSlot);
  return { start, size: end - start + 1 };
}

function syncSelectionBox(box) {
  const range = getSelectionRange();
  box.style.setProperty("--selection-start", range.start);
  box.style.setProperty("--selection-size", range.size);
}

function syncEmptyPageViewport() {
  if (!providerColumns.classList.contains("has-empty-page")) return;

  const visibleHeight = scheduleScroll?.clientHeight || providerViewport?.clientHeight || 520;
  providerColumns.style.setProperty("--empty-visible-h", `${Math.max(320, visibleHeight)}px`);
}

function getSlotIndexFromPoint(body, clientY) {
  const rect = body.getBoundingClientRect();
  const index = Math.floor((clientY - rect.top) / parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--slot-h")));
  return clamp(index, 0, times.length - 1);
}

function updateSelectionVisuals() {
  document.querySelectorAll(".provider-card").forEach((card) => {
    const isGroupCard = card.classList.contains("is-group-card");
    const isSelectedCard = isGroupCard
      ? Array.from(card.querySelectorAll(".group-tab")).some(
          (tab) => Number(tab.dataset.providerId) === selectedProviderId,
        )
      : Number(card.dataset.providerId) === selectedProviderId;
    card.classList.toggle("is-selected", isSelectedCard);
    if (isGroupCard && isSelectedCard) {
      const group = findGroupByProvider(selectedProviderId);
      if (group) {
        activeGroupProviderIds.set(group.id, selectedProviderId);
      }
      card.dataset.providerId = String(selectedProviderId);
      card.querySelectorAll(".group-tab").forEach((tab) => {
        tab.classList.toggle("active", Number(tab.dataset.providerId) === selectedProviderId);
      });
    }

    const body = card.querySelector(".slot-body");
    if (!body) return;

    let box = body.querySelector(".selection-box");
    if (isSelectedCard) {
      if (!box) {
        box = createSelectionBox();
        body.append(box);
      }
      syncSelectionBox(box);
    } else if (box) {
      box.remove();
    }
  });
}

function createEmptyPageState(pageIndex) {
  const state = document.createElement("section");
  state.className = "empty-page-state";
  state.setAttribute("aria-label", "빈 페이지");

  const title = document.createElement("h2");
  title.textContent = "빈 페이지";

  const description = document.createElement("p");
  description.textContent = "캘린더가 존재하지 않습니다.";

  const actions = document.createElement("div");
  actions.className = "empty-page-actions";

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "ghost";
  addButton.textContent = "캘린더 추가";
  addButton.addEventListener("click", () => {
    openPageCalendarDialog(pageIndex);
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger";
  deleteButton.textContent = "페이지 삭제";
  deleteButton.addEventListener("click", () => {
    deleteEmptyPage(pageIndex);
  });

  actions.append(addButton, deleteButton);
  state.append(title, description, actions);
  return state;
}

function getAnchoredStartIndex(displayItems, focusIndex, preferredSlotIndex = 0) {
  if (focusIndex < 0) return firstVisibleIndex;

  let startIndex = clamp(focusIndex - preferredSlotIndex, 0, displayItems.length - 1);

  while (startIndex < focusIndex) {
    const count = getResponsiveVisibleCount(displayItems, startIndex);
    if (focusIndex < startIndex + count) {
      return startIndex;
    }
    startIndex += 1;
  }

  return focusIndex;
}

function renderScheduler(options = {}) {
  syncSelectedProvider();
  const activeProviders = getActiveProviders();
  const allDisplayItems = getDisplayItems();
  let displayItems = allDisplayItems;
  if (usesManualPages()) {
    currentPageIndex = clamp(currentPageIndex, 0, Math.max(0, pageLayouts.length - 1));
    displayItems = getPageDisplayItems(currentPageIndex, allDisplayItems);
  }
  providerColumns.innerHTML = "";
  providerColumns.classList.remove("default-view", "single-view", "max-view");
  providerColumns.classList.remove("has-empty-page");
  providerColumns.classList.add(`${viewMode}-view`);
  providerColumns.style.setProperty("--time-row-count", times.length);

  if (!allDisplayItems.length || !displayItems.length) {
    visibleCount = 0;
    if (!usesManualPages()) {
      firstVisibleIndex = 0;
    }
    currentVisibleItems = [];
    columnWeights = [];
    columnWeightKeys = [];
    providerColumns.style.setProperty("--visible-columns", 0);
    providerColumns.style.gridTemplateColumns = "1fr";
    providerColumns.style.minWidth = "";
    providerColumns.style.width = "";
    if (usesManualPages()) {
      providerColumns.classList.add("has-empty-page");
      scheduleScroll.scrollTop = 0;
      syncEmptyPageViewport();
      providerColumns.append(createEmptyPageState(currentPageIndex));
    }
    renderPageControls(allDisplayItems);
    const totalPages = usesManualPages() ? pageLayouts.length : 0;
    const page = usesManualPages() ? currentPageIndex + 1 : 0;
    prevPageButton.disabled = totalPages <= 1 || page <= 1;
    nextPageButton.disabled = totalPages <= 1 || page >= totalPages;
    visibleDoctorCount.textContent = "0건";
    totalDoctorCount.textContent = `${activeProviders.length}건`;
    renderProviderHeaders();
    syncProviderBottomScrollbar();
    syncScheduleVerticalScrollbar();
    return;
  }

  if (usesManualPages()) {
    visibleCount = viewMode === "single" ? 1 : displayItems.length;
    firstVisibleIndex = 0;
  } else if (!options.preserveVisibleCount) {
    if (viewMode === "max") {
      firstVisibleIndex = 0;
    }
    if (Number.isFinite(options.anchorSlotIndex)) {
      const focusIndex = getSelectedDisplayIndex(displayItems);
      firstVisibleIndex = getAnchoredStartIndex(displayItems, focusIndex, options.anchorSlotIndex);
    }
    visibleCount = getResponsiveVisibleCount(displayItems, firstVisibleIndex);
    if (Number.isFinite(options.desiredVisibleCount)) {
      visibleCount = getFilledVisibleCount(displayItems, firstVisibleIndex, visibleCount, options.desiredVisibleCount);
    }
  }

  visibleCount = clamp(visibleCount, 1, displayItems.length);

  if (usesManualPages()) {
    if (viewMode === "single") {
      const singleIndex = getPreferredSingleIndex(displayItems);
      firstVisibleIndex = clamp(singleIndex, 0, Math.max(0, displayItems.length - 1));
      currentVisibleItems = displayItems.slice(firstVisibleIndex, firstVisibleIndex + 1);
    } else {
      currentVisibleItems = displayItems;
    }
  } else if (viewMode === "single") {
    firstVisibleIndex = getPreferredSingleIndex(displayItems);
  } else if (viewMode === "max") {
    firstVisibleIndex = 0;
  } else if (options.alignPage !== false) {
    firstVisibleIndex = Math.floor(firstVisibleIndex / visibleCount) * visibleCount;
  }

  if (!usesManualPages()) {
    firstVisibleIndex = clamp(firstVisibleIndex, 0, Math.max(0, displayItems.length - visibleCount));
    currentVisibleItems = displayItems.slice(firstVisibleIndex, firstVisibleIndex + visibleCount);
  }
  const forceUniformWeights = usesManualPages() && autoFitPageIndexes.has(currentPageIndex);
  ensureColumnWeights(visibleCount, options.resetWeights, forceUniformWeights);
  providerColumns.style.setProperty("--visible-columns", visibleCount);
  applyProviderGridColumns();

  currentVisibleItems.forEach((item, index) => {
    providerColumns.append(renderCalendarItem(item));
    if (index < visibleCount - 1) {
      providerColumns.append(createCardResizeHandle(index));
    }
  });
  renderProviderHeaders();
  refreshGroupTabDisplayModes();
  syncProviderBottomScrollbar();
  syncScheduleVerticalScrollbar();

  const { page, totalPages } = renderPageControls(allDisplayItems);
  prevPageButton.disabled = totalPages <= 1 || page <= 1;
  nextPageButton.disabled = totalPages <= 1 || page >= totalPages;
  visibleDoctorCount.textContent = `${visibleCount}건`;
  totalDoctorCount.textContent = `${activeProviders.length}건`;
}

function updateVisibleColumns() {
  const displayItems = getDisplayItems();
  const width = providerColumns.getBoundingClientRect().width;
  if (!width || !displayItems.length) return;

  if (usesManualPages()) {
    providerColumns.style.setProperty("--visible-columns", visibleCount);
    applyProviderGridColumns();
    syncProviderBottomScrollbar();
    syncScheduleVerticalScrollbar();
    return;
  }

  let nextVisibleCount = getResponsiveVisibleCount(displayItems, firstVisibleIndex);
  nextVisibleCount = getFilledVisibleCount(displayItems, firstVisibleIndex, nextVisibleCount, visibleCount);

  if (nextVisibleCount !== visibleCount) {
    visibleCount = nextVisibleCount;
    renderScheduler({ resetWeights: true, preserveVisibleCount: true });
  } else {
    providerColumns.style.setProperty("--visible-columns", visibleCount);
    applyProviderGridColumns();
    syncProviderBottomScrollbar();
    syncScheduleVerticalScrollbar();
  }
}

function getItemRequiredWidth(item) {
  const mode = cardViewModes[viewMode];
  if (item?.type === "group") {
    if (viewMode === "single") return mode.targetWidth;

    const visibleTabs = Math.min(item.providers.length, viewMode === "max" ? 1 : 4);
    const comfortableTabWidth = viewMode === "max" ? 56 : 86;
    return Math.max(getItemMinimumWidth(item), mode.targetWidth, Math.min(360, visibleTabs * comfortableTabWidth));
  }

  return mode.targetWidth;
}

function getGroupMinimumWidth(item) {
  const tabCount = Math.max(1, item?.providers?.length || 1);
  return groupTabMinWidth * tabCount + groupTabGap * Math.max(0, tabCount - 1) + groupTabPaddingX;
}

function getItemMinimumWidth(item) {
  if (item?.type === "group") {
    return getGroupMinimumWidth(item);
  }

  return viewMode === "max" ? 56 : 48;
}

function canFitVisibleCount(displayItems, startIndex, count, widthResolver) {
  const width = providerColumns.getBoundingClientRect().width || schedulerPane.getBoundingClientRect().width;
  const handleWidth = 12;
  let usedWidth = 0;

  for (let offset = 0; offset < count; offset += 1) {
    const item = displayItems[startIndex + offset];
    if (!item) return false;

    usedWidth += widthResolver(item);
    if (offset > 0) {
      usedWidth += handleWidth;
    }

    if (usedWidth > width) {
      return false;
    }
  }

  return true;
}

function getFilledVisibleCount(displayItems, startIndex, baseCount, desiredCount) {
  if (viewMode === "max") return baseCount;

  const mode = cardViewModes[viewMode];
  const maxCount = Math.min(mode.maxColumns, displayItems.length - startIndex);
  const targetCount = clamp(desiredCount, baseCount, maxCount);

  for (let count = targetCount; count > baseCount; count -= 1) {
    if (canFitVisibleCount(displayItems, startIndex, count, getItemMinimumWidth)) {
      return count;
    }
  }

  return baseCount;
}

function getResponsiveVisibleCount(displayItems = getDisplayItems(), startIndex = firstVisibleIndex) {
  if (!displayItems.length) return 0;
  if (viewMode === "single") return 1;
  if (viewMode === "max") return displayItems.length;

  const width = providerColumns.getBoundingClientRect().width || schedulerPane.getBoundingClientRect().width;
  const mode = cardViewModes[viewMode];
  const handleWidth = 12;
  let usedWidth = 0;
  let count = 0;

  for (let index = startIndex; index < displayItems.length && count < mode.maxColumns; index += 1) {
    const itemWidth = getItemRequiredWidth(displayItems[index]);
    const nextWidth = usedWidth + itemWidth + (count > 0 ? handleWidth : 0);
    if (nextWidth > width && count > 0) break;

    usedWidth = nextWidth;
    count += 1;
  }

  return clamp(count, 1, Math.min(mode.maxColumns, displayItems.length - startIndex));
}

function beginSlotSelection(event, index, providerId) {
  selectedSlot = clamp(index, 0, times.length - 2);
  selectionEndSlot = selectedSlot;
  selectedProviderId = providerId;
  const group = findGroupByProvider(providerId);
  if (group) {
    activeGroupProviderIds.set(group.id, providerId);
  }
  updateTimeFields();
  updateSelectionVisuals();

  const body = event.currentTarget.closest(".slot-body");
  const onMove = (moveEvent) => {
    selectionEndSlot = getSlotIndexFromPoint(body, moveEvent.clientY);
    updateTimeFields();
    updateSelectionVisuals();
  };
  const onEnd = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onEnd);
    document.removeEventListener("pointercancel", onEnd);
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onEnd);
  document.addEventListener("pointercancel", onEnd);
}

function updateTimeFields() {
  const range = getSelectionRange();
  const start = times[range.start];
  const end = times[Math.min(range.start + range.size, times.length - 1)];

  if (timeSelects[0]) {
    timeSelects[0].options[0].textContent = start.label;
    timeSelects[0].options[0].value = start.label;
  }

  if (timeSelects[1]) {
    timeSelects[1].options[0].textContent = end.label;
    timeSelects[1].options[0].value = end.label;
  }

  updateCalendarField();
}

function movePage(direction) {
  const displayItems = getDisplayItems();
  if (!displayItems.length) return;

  if (usesManualPages()) {
    currentPageIndex = clamp(currentPageIndex + direction, 0, Math.max(0, pageLayouts.length - 1));
    renderScheduler({ resetWeights: true });
    return;
  }

  firstVisibleIndex = clamp(
    firstVisibleIndex + direction * visibleCount,
    0,
    Math.max(0, displayItems.length - visibleCount),
  );

  if (viewMode === "single") {
    selectedProviderId = getPrimaryProviderIdFromItem(displayItems[firstVisibleIndex]);
    updateCalendarField();
  }

  renderScheduler({ resetWeights: true, preserveVisibleCount: true });
}

function installObservers() {
  const observer = new ResizeObserver(() => {
    const widths = getCurrentWidths();
    applyWidths(widths.left, widths.right, { store: false });
    updateVisibleColumns();
    syncEmptyPageViewport();
    syncProviderBottomScrollbar();
    syncScheduleVerticalScrollbar();
  });

  observer.observe(layout);
  observer.observe(schedulerPane);
  if (scheduleScroll) {
    observer.observe(scheduleScroll);
  }
  if (providerViewport) {
    observer.observe(providerViewport);
  }
}

function updateSortState() {
  sortPopover.querySelectorAll("[data-view-mode]").forEach((button) => {
    const isCurrentMode = button.dataset.viewMode === viewMode;
    button.classList.toggle("active", isCurrentMode);
    button.disabled = isPageEditMode && !isCurrentMode;
    button.setAttribute("aria-disabled", String(button.disabled));
  });
  sortPopover.querySelector("[data-page-edit]")?.classList.toggle("active", isPageEditMode);
}

function updatePageEditState() {
  schedulerPane.classList.toggle("is-page-editing", isPageEditMode);
  providerColumns.classList.toggle("is-page-editing", isPageEditMode);
  providerHeaderColumns?.classList.toggle("is-page-editing", isPageEditMode);
  if (pageEditActions) {
    pageEditActions.hidden = !isPageEditMode;
  }
}

function createPageEditSnapshot() {
  return {
    pageLayouts: pageLayouts.map((page) => [...page]),
    calendarOrder: [...calendarOrder],
    currentPageIndex,
    itemWidthWeights: new Map(itemWidthWeights),
    pageWidthEditVersions: new Map(pageWidthEditVersions),
    hiddenWidthStates: new Map(hiddenWidthStates),
    autoFitPageIndexes: new Set(autoFitPageIndexes),
  };
}

function beginPageEditMode() {
  if (isPageEditMode) return;

  pageEditSnapshot = createPageEditSnapshot();
  isPageEditMode = true;
  preparePageEditModeForCurrentView();
  updatePageEditState();
  updateSortState();
  closeSortPopover();
  closePageContextMenu();
  renderScheduler({ resetWeights: true });
  showToast("페이지 구성 편집 중입니다. 카드 전체를 페이지 칩이나 좌우 바깥 영역으로 드래그해 이동하세요");
}

function cancelPageEditMode() {
  if (!isPageEditMode) return;

  if (pageEditSnapshot) {
    pageLayouts = pageEditSnapshot.pageLayouts.map((page) => [...page]);
    calendarOrder = [...pageEditSnapshot.calendarOrder];
    currentPageIndex = pageEditSnapshot.currentPageIndex;
    itemWidthWeights = new Map(pageEditSnapshot.itemWidthWeights);
    pageWidthEditVersions = new Map(pageEditSnapshot.pageWidthEditVersions);
    hiddenWidthStates = new Map(pageEditSnapshot.hiddenWidthStates);
    autoFitPageIndexes = new Set(pageEditSnapshot.autoFitPageIndexes);
    storePageLayouts();
    storeCardWeights();
  }

  pageEditSnapshot = null;
  isPageEditMode = false;
  updatePageEditState();
  updateSortState();
  closePageContextMenu();
  renderScheduler({ resetWeights: true });
  renderDoctorList();
  showToast("페이지 구성 편집을 취소했습니다");
}

function savePageEditMode() {
  if (!isPageEditMode) return;

  pageEditSnapshot = null;
  isPageEditMode = false;
  storePageLayouts();
  storeCardWeights();
  closePageContextMenu();
  setViewMode("default");
  renderDoctorList();
  showToast("페이지 구성을 저장하고 캘린더 기본 보기로 전환했습니다");
}

function openSortPopover() {
  sortPopover.hidden = false;
  sortButton.setAttribute("aria-expanded", "true");
}

function closeSortPopover() {
  sortPopover.hidden = true;
  sortButton.setAttribute("aria-expanded", "false");
}

function toggleSortPopover() {
  if (sortPopover.hidden) {
    openSortPopover();
  } else {
    closeSortPopover();
  }
}

function attachSortMenu() {
  sortButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSortPopover();
  });

  sortPopover.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-page-edit]");
    if (editButton) {
      beginPageEditMode();
      return;
    }

    const button = event.target.closest("[data-view-mode]");
    if (!button) return;
    if (button.disabled) return;
    setViewMode(button.dataset.viewMode);
  });

  pageEditCancel?.addEventListener("click", cancelPageEditMode);
  pageEditSave?.addEventListener("click", savePageEditMode);

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#sortMenu")) {
      closeSortPopover();
    }
    if (!event.target.closest(".page-context-menu") && !event.target.closest(".page-chip")) {
      closePageContextMenu();
    }
    if (!event.target.closest(".calendar-action-menu") && !event.target.closest(".provider-menu")) {
      closeCalendarActionMenu();
    }
  });
  document.addEventListener("dragover", trackDraggedCardPosition);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSortPopover();
      closeCalendarActionMenu();
      closePageContextMenu();
      document.querySelector(".merge-dialog-backdrop")?.remove();
    }
  });

  updateSortState();
}

function init() {
  syncCalendarOrderFromPageLayouts();
  updatePageEditState();
  renderDoctorList();
  renderCalendarSelect();
  renderTimeAxis();
  renderScheduler();
  attachResizeHandles();
  attachSortMenu();
  updateTimeFields();
  applyWidths(readStoredWidths().left, readStoredWidths().right, { store: false });
  installObservers();

  prevPageButton.addEventListener("click", () => movePage(-1));
  nextPageButton.addEventListener("click", () => movePage(1));
  providerBottomScroll?.addEventListener("scroll", () => {
    applyProviderHorizontalScroll(providerBottomScroll.scrollLeft);
  });
  scheduleScroll?.addEventListener("scroll", () => {
    if (isSyncingVerticalScroll || !scheduleVerticalScroll) return;
    isSyncingVerticalScroll = true;
    scheduleVerticalScroll.scrollTop = scheduleScroll.scrollTop;
    isSyncingVerticalScroll = false;
  });
  scheduleVerticalScroll?.addEventListener("scroll", () => {
    if (isSyncingVerticalScroll || !scheduleScroll) return;
    isSyncingVerticalScroll = true;
    scheduleScroll.scrollTop = scheduleVerticalScroll.scrollTop;
    isSyncingVerticalScroll = false;
  });
}

init();
