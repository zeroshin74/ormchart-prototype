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

const storageKey = "reservation-popup-pane-widths";
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
  "박병철(내과)",
  "박지은(정형외과)",
];

const providers = Array.from({ length: 64 }, (_, index) => {
  const name = doctorSeed[index % doctorSeed.length];
  const count = index === 7 || index === 23 ? 1 : 0;
  return {
    id: index + 1,
    name,
    count,
    color: colorSet[index % colorSet.length],
  };
});

const times = buildTimes();
const defaultStartIndex = providers.findIndex((provider) => provider.name === "김태석(내과)");
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
let calendarOrder = providers.map((provider) => provider.id);
let calendarGroups = [];
let groupIdSequence = 1;
let activeGroupProviderIds = new Map();
let activeActionMenu = null;
let draggedTabProviderId = null;
let currentVisibleItems = [];
let tabClickTimer = null;
let draggedCardProviderId = null;
let toastTimer = null;
let mergeFocusTimer = null;
let resizeLimitFeedbackTimer = null;
let lastResizeLimitToastAt = 0;
let isSyncingVerticalScroll = false;

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

function storeWidths(widths) {
  localStorage.setItem(storageKey, JSON.stringify(widths));
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
  providers.forEach((provider, index) => {
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
      if (checkbox.checked) {
        activeProviderIds.add(provider.id);
      } else {
        activeProviderIds.delete(provider.id);
      }
      label.style.opacity = checkbox.checked ? "1" : "0.45";
      syncSelectedProvider();
      firstVisibleIndex = clamp(firstVisibleIndex, 0, Math.max(0, getActiveProviders().length - visibleCount));
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

function ensureColumnWeights(count, reset = false) {
  if (reset || columnWeights.length !== count) {
    columnWeights = Array.from({ length: count }, () => 1);
  }
}

function applyProviderGridColumns() {
  updateProviderColumnsScrollWidth();

  if (visibleCount <= 1) {
    const minColumn = getColumnMinWidth(0);
    providerColumns.style.gridTemplateColumns = `minmax(${minColumn}, 1fr)`;
    syncProviderHeaderColumnsStyle();
    refreshGroupTabDisplayModes();
    return;
  }

  ensureColumnWeights(visibleCount);
  providerColumns.style.gridTemplateColumns = columnWeights
    .map((weight, index) => {
      const cardColumn = `minmax(${getColumnMinWidth(index)}, ${weight.toFixed(3)}fr)`;
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

function syncProviderBottomScrollbar() {
  if (!scheduleHorizontalBar || !providerBottomScroll || !providerBottomSpacer || !providerViewport) return;

  const fullWidth = Math.ceil(providerColumns.getBoundingClientRect().width);
  const viewportWidth = Math.ceil(providerViewport.getBoundingClientRect().width);
  const shouldShow = viewMode === "max" && fullWidth > viewportWidth + 1;

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
  if (viewMode !== "max" || !currentVisibleItems.length) {
    providerColumns.style.minWidth = "";
    providerColumns.style.width = "";
    syncProviderHeaderColumnsStyle();
    requestAnimationFrame(syncProviderBottomScrollbar);
    requestAnimationFrame(syncScheduleVerticalScrollbar);
    return;
  }

  const handleWidth = 12;
  const minimumWidth = currentVisibleItems.reduce((sum, item, index) => {
    return sum + getItemMinimumWidth(item) + (index > 0 ? handleWidth : 0);
  }, 0);

  providerColumns.style.minWidth = `${minimumWidth}px`;
  providerColumns.style.width = "100%";
  syncProviderHeaderColumnsStyle();
  requestAnimationFrame(syncProviderBottomScrollbar);
  requestAnimationFrame(syncScheduleVerticalScrollbar);
}

function getColumnMinWidth(index) {
  const item = currentVisibleItems[index];
  if (item?.type === "group") {
    return "56px";
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

function getCardResizeScale() {
  return viewMode === "max" ? 1 : 1.35;
}

function getRedistributedWeights(startWeights, handleIndex, deltaPx, totalCardWidth) {
  if (!deltaPx || totalCardWidth <= 0) return [...startWeights];

  const nextWeights = [...startWeights];
  const minWeight = getCollapsedWeight();
  const sumWeights = startWeights.reduce((sum, weight) => sum + weight, 0);
  const requestedShrink = (Math.abs(deltaPx) / totalCardWidth) * sumWeights * getCardResizeScale();
  const dragToLeft = deltaPx < 0;
  const shrinkIndexes = dragToLeft
    ? Array.from({ length: handleIndex + 1 }, (_, index) => index)
    : Array.from({ length: startWeights.length - handleIndex - 1 }, (_, index) => handleIndex + 1 + index);
  const growIndex = dragToLeft ? handleIndex + 1 : handleIndex;
  const totalAvailableShrink = shrinkIndexes.reduce(
    (sum, index) => sum + Math.max(0, startWeights[index] - minWeight),
    0,
  );
  const actualShrink = Math.min(requestedShrink, totalAvailableShrink);

  if (actualShrink <= 0) return nextWeights;

  shrinkIndexes.forEach((index) => {
    const available = Math.max(0, startWeights[index] - minWeight);
    const shrink = totalAvailableShrink ? actualShrink * (available / totalAvailableShrink) : 0;
    nextWeights[index] = Math.max(minWeight, startWeights[index] - shrink);
  });

  nextWeights[growIndex] = startWeights[growIndex] + actualShrink;
  return nextWeights;
}

function getPreferredSingleIndex(displayItems = getDisplayItems()) {
  if (!selectedProviderId) return 0;

  const selectedIndex = getSelectedDisplayIndex(displayItems);
  if (selectedIndex >= 0) return selectedIndex;

  return 0;
}

function setViewMode(nextMode, options = {}) {
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
    draggedCardProviderId = provider.id;
    header.classList.add("dragging");
    providerColumns.classList.add("is-dragging-cards");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(provider.id));
  });

  header.addEventListener("dragend", () => {
    draggedCardProviderId = null;
    header.classList.remove("dragging");
    providerColumns.classList.remove("is-dragging-cards");
  });

  header.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });

  header.addEventListener("drop", (event) => {
    event.preventDefault();
    reorderStandaloneCard(draggedCardProviderId, provider.id);
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
    row.addEventListener("pointerdown", (event) => beginSlotSelection(event, index, providerId));
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
  menu.append(
    createActionButton("캘린더 합치기", () => openMergeDialog(context.providerId, context)),
    createActionButton("분리하기", () => splitProviderFromGroup(context.providerId)),
    createActionButton("전체 분리하기", () => splitAllCalendars(context.providerId)),
    createActionButton("예약자 목록 출력  ›", () => {
      closeCalendarActionMenu();
      showToast("예약자 목록 출력을 할 수 없습니다");
    }),
  );

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

  const nextActiveOrder = displayUnits.flat();
  calendarOrder = [...nextActiveOrder, ...previousOrder.filter((providerId) => !nextActiveOrder.includes(providerId))];
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
    const startWeights = [...columnWeights];
    const totalCardWidth = cards.reduce((sum, card) => sum + card.getBoundingClientRect().width, 0);

    handle.setPointerCapture(event.pointerId);
    handle.classList.add("active");

    const onMove = (moveEvent) => {
      const nextWeights = getRedistributedWeights(startWeights, index, moveEvent.clientX - startX, totalCardWidth);
      if (Math.abs(moveEvent.clientX - startX) > 4 && areWeightsEqual(nextWeights, columnWeights)) {
        showResizeLimitFeedback(handle);
        return;
      }

      handle.classList.remove("is-limited");
      columnWeights = nextWeights;
      applyProviderGridColumns();
    };

    const onEnd = () => {
      handle.classList.remove("active", "is-limited");
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  });

  handle.addEventListener("dblclick", () => {
    columnWeights = Array.from({ length: visibleCount }, () => 1);
    applyProviderGridColumns();
  });

  handle.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    const index = Number(handle.dataset.cardResizeIndex);

    if (event.key === "Home" || event.key === "End") {
      columnWeights = Array.from({ length: visibleCount }, () => 1);
    } else {
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const virtualCardWidth = visibleCount * 220;
      const virtualDelta = direction * (event.shiftKey ? 96 : 48);
      const nextWeights = getRedistributedWeights(columnWeights, index, virtualDelta, virtualCardWidth);
      if (areWeightsEqual(nextWeights, columnWeights)) {
        showResizeLimitFeedback(handle);
        return;
      }

      handle.classList.remove("is-limited");
      columnWeights = nextWeights;
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
  const displayItems = getDisplayItems();
  providerColumns.innerHTML = "";
  providerColumns.classList.remove("default-view", "single-view", "max-view");
  providerColumns.classList.add(`${viewMode}-view`);

  if (!displayItems.length) {
    visibleCount = 0;
    firstVisibleIndex = 0;
  currentVisibleItems = [];
  pageIndicator.textContent = "0 / 0";
  visibleDoctorCount.textContent = "0건";
  totalDoctorCount.textContent = "0건";
  providerColumns.style.gridTemplateColumns = "1fr";
  renderProviderHeaders();
  syncProviderBottomScrollbar();
  syncScheduleVerticalScrollbar();
  return;
}

  if (!options.preserveVisibleCount) {
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

  if (viewMode === "single") {
    firstVisibleIndex = getPreferredSingleIndex(displayItems);
  } else if (viewMode === "max") {
    firstVisibleIndex = 0;
  } else if (options.alignPage !== false) {
    firstVisibleIndex = Math.floor(firstVisibleIndex / visibleCount) * visibleCount;
  }

  firstVisibleIndex = clamp(firstVisibleIndex, 0, Math.max(0, displayItems.length - visibleCount));
  ensureColumnWeights(visibleCount, options.resetWeights);
  providerColumns.style.setProperty("--visible-columns", visibleCount);
  currentVisibleItems = displayItems.slice(firstVisibleIndex, firstVisibleIndex + visibleCount);
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

  const page = Math.floor(firstVisibleIndex / visibleCount) + 1;
  const totalPages = Math.ceil(displayItems.length / visibleCount);
  pageIndicator.textContent = `${page} / ${totalPages}`;
  prevPageButton.disabled = totalPages <= 1 || page <= 1;
  nextPageButton.disabled = totalPages <= 1 || page >= totalPages;
  visibleDoctorCount.textContent = `${visibleCount}건`;
  totalDoctorCount.textContent = `${activeProviders.length}건`;
}

function updateVisibleColumns() {
  const displayItems = getDisplayItems();
  const width = providerColumns.getBoundingClientRect().width;
  if (!width || !displayItems.length) return;

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
    return Math.max(mode.targetWidth, Math.min(360, visibleTabs * comfortableTabWidth));
  }

  return mode.targetWidth;
}

function getItemMinimumWidth(item) {
  if (item?.type === "group") {
    return 56;
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
  event.preventDefault();
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
    button.classList.toggle("active", button.dataset.viewMode === viewMode);
  });
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
    const button = event.target.closest("[data-view-mode]");
    if (!button) return;
    setViewMode(button.dataset.viewMode);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#sortMenu")) {
      closeSortPopover();
    }
    if (!event.target.closest(".calendar-action-menu") && !event.target.closest(".provider-menu")) {
      closeCalendarActionMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSortPopover();
      closeCalendarActionMenu();
      document.querySelector(".merge-dialog-backdrop")?.remove();
    }
  });

  updateSortState();
}

function init() {
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
