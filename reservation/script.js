const layout = document.querySelector("#reservationLayout");
const schedulerPane = document.querySelector("#schedulerPane");
const providerColumns = document.querySelector("#providerColumns");
const timeAxis = document.querySelector("#timeAxis");
const doctorList = document.querySelector("#doctorList");
const pageIndicator = document.querySelector("#pageIndicator");
const prevPageButton = document.querySelector("#prevPage");
const nextPageButton = document.querySelector("#nextPage");
const visibleDoctorCount = document.querySelector("#visibleDoctorCount");
const totalDoctorCount = document.querySelector("#totalDoctorCount");
const timeSelects = document.querySelectorAll(".time-range select");
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
  max: { label: "캘린더 최대 보기", maxColumns: 20, targetWidth: 54 },
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

function getActiveProviders() {
  return providers.filter((provider) => activeProviderIds.has(provider.id));
}

function syncSelectedProvider() {
  const activeProviders = getActiveProviders();
  if (selectedProviderId && !activeProviders.some((provider) => provider.id === selectedProviderId)) {
    selectedProviderId = null;
  }
}

function getSelectedProviderIndex(activeProviders = getActiveProviders()) {
  if (!selectedProviderId) return -1;
  return activeProviders.findIndex((provider) => provider.id === selectedProviderId);
}

function ensureColumnWeights(count, reset = false) {
  if (reset || columnWeights.length !== count) {
    columnWeights = Array.from({ length: count }, () => 1);
  }
}

function applyProviderGridColumns() {
  if (visibleCount <= 1) {
    providerColumns.style.gridTemplateColumns = "minmax(var(--card-min), 1fr)";
    return;
  }

  ensureColumnWeights(visibleCount);
  providerColumns.style.gridTemplateColumns = columnWeights
    .map((weight, index) => {
      const cardColumn = `minmax(var(--card-min), ${weight.toFixed(3)}fr)`;
      return index === visibleCount - 1 ? cardColumn : `${cardColumn} 12px`;
    })
    .join(" ");
}

function getPreferredSingleIndex(activeProviders = getActiveProviders()) {
  const selectedIndex = getSelectedProviderIndex(activeProviders);
  if (selectedIndex >= 0) return selectedIndex;

  return clamp(firstVisibleIndex, 0, Math.max(0, activeProviders.length - 1));
}

function setViewMode(nextMode, options = {}) {
  if (nextMode === "single" && viewMode !== "single") {
    previousNonSingleViewMode = viewMode;
  } else if (nextMode !== "single") {
    previousNonSingleViewMode = nextMode;
  }

  viewMode = nextMode;
  const activeProviders = getActiveProviders();

  if (viewMode === "single") {
    firstVisibleIndex = getPreferredSingleIndex(activeProviders);
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

function renderProviderCard(provider) {
  const card = document.createElement("article");
  card.className = "provider-card";
  card.dataset.providerId = String(provider.id);
  if (provider.id === selectedProviderId) {
    card.classList.add("is-selected");
  }

  const header = document.createElement("header");
  const name = document.createElement("div");
  name.className = "provider-name";

  const chip = document.createElement("span");
  chip.className = "name-chip";
  chip.textContent = provider.name.slice(0, 1);
  chip.style.color = provider.color;
  chip.style.background = getChipColor(provider.color);

  const label = document.createElement("span");
  label.textContent = provider.count ? `${provider.name} ${provider.count}건` : provider.name;

  const menu = document.createElement("button");
  menu.className = "provider-menu";
  menu.type = "button";
  menu.setAttribute("aria-label", `${provider.name} 더보기`);
  menu.textContent = "⋮";

  name.append(chip, label);
  name.title = "더블클릭하면 이 캘린더만 봅니다";
  name.addEventListener("dblclick", () => {
    toggleSingleProvider(provider.id);
  });
  header.append(name, menu);

  const body = document.createElement("div");
  body.className = "slot-body";
  body.dataset.providerId = String(provider.id);
  body.style.setProperty("--busy-start", fixedBusyStartSlot);

  const busyBlock = document.createElement("div");
  busyBlock.className = "busy-block";
  busyBlock.setAttribute("aria-hidden", "true");

  body.append(busyBlock);

  times.forEach((time, index) => {
    const row = document.createElement("div");
    row.className = "slot-row";
    row.dataset.slotIndex = String(index);
    row.role = "button";
    row.tabIndex = -1;
    row.setAttribute("aria-label", `${provider.name} ${time.label} 예약 선택`);
    row.addEventListener("pointerdown", (event) => beginSlotSelection(event, index, provider.id));
    body.append(row);
  });

  if (provider.id === selectedProviderId) {
    body.append(createSelectionBox());
  }

  if (provider.id % 9 === 0) {
    const appointment = document.createElement("button");
    appointment.type = "button";
    appointment.className = "appointment-block is-dim";
    appointment.style.top = `calc(var(--slot-h) * ${Math.max(4, fixedBusyStartSlot - 6)} + 5px)`;
    appointment.textContent = "진료 대기";
    body.append(appointment);
  }

  card.append(header, body);
  return card;
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
    const leftCard = cards[index];
    const rightCard = cards[index + 1];
    if (!leftCard || !rightCard) return;

    const startX = event.clientX;
    const startWeights = [...columnWeights];
    const pairWeight = startWeights[index] + startWeights[index + 1];
    const pairWidth = leftCard.getBoundingClientRect().width + rightCard.getBoundingClientRect().width;
    const minWeight = viewMode === "max" ? 0.22 : 0.35;

    handle.setPointerCapture(event.pointerId);
    handle.classList.add("active");

    const onMove = (moveEvent) => {
      const deltaRatio = ((moveEvent.clientX - startX) / pairWidth) * pairWeight;
      const nextLeft = clamp(startWeights[index] + deltaRatio, minWeight, pairWeight - minWeight);
      columnWeights[index] = nextLeft;
      columnWeights[index + 1] = pairWeight - nextLeft;
      applyProviderGridColumns();
    };

    const onEnd = () => {
      handle.classList.remove("active");
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
    const step = event.shiftKey ? 0.18 : 0.08;
    const pairWeight = columnWeights[index] + columnWeights[index + 1];
    const minWeight = viewMode === "max" ? 0.22 : 0.35;

    if (event.key === "Home" || event.key === "End") {
      columnWeights = Array.from({ length: visibleCount }, () => 1);
    } else {
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const nextLeft = clamp(columnWeights[index] + direction * step, minWeight, pairWeight - minWeight);
      columnWeights[index] = nextLeft;
      columnWeights[index + 1] = pairWeight - nextLeft;
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
    const isSelectedCard = Number(card.dataset.providerId) === selectedProviderId;
    card.classList.toggle("is-selected", isSelectedCard);

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

function renderScheduler(options = {}) {
  syncSelectedProvider();
  const activeProviders = getActiveProviders();
  providerColumns.innerHTML = "";
  providerColumns.classList.remove("default-view", "single-view", "max-view");
  providerColumns.classList.add(`${viewMode}-view`);

  if (!activeProviders.length) {
    visibleCount = 0;
    firstVisibleIndex = 0;
    pageIndicator.textContent = "0 / 0";
    visibleDoctorCount.textContent = "0건";
    totalDoctorCount.textContent = "0건";
    providerColumns.style.gridTemplateColumns = "1fr";
    return;
  }

  if (!options.preserveVisibleCount) {
    visibleCount = getResponsiveVisibleCount(activeProviders);
  }

  visibleCount = clamp(visibleCount, 1, activeProviders.length);

  if (viewMode === "single") {
    firstVisibleIndex = getPreferredSingleIndex(activeProviders);
  } else if (options.alignPage !== false) {
    firstVisibleIndex = Math.floor(firstVisibleIndex / visibleCount) * visibleCount;
  }

  firstVisibleIndex = clamp(firstVisibleIndex, 0, Math.max(0, activeProviders.length - visibleCount));
  ensureColumnWeights(visibleCount, options.resetWeights);
  providerColumns.style.setProperty("--visible-columns", visibleCount);
  applyProviderGridColumns();

  activeProviders.slice(firstVisibleIndex, firstVisibleIndex + visibleCount).forEach((provider, index) => {
    providerColumns.append(renderProviderCard(provider));
    if (index < visibleCount - 1) {
      providerColumns.append(createCardResizeHandle(index));
    }
  });

  const page = Math.floor(firstVisibleIndex / visibleCount) + 1;
  const totalPages = Math.ceil(activeProviders.length / visibleCount);
  pageIndicator.textContent = `${page} / ${totalPages}`;
  visibleDoctorCount.textContent = `${visibleCount}건`;
  totalDoctorCount.textContent = `${activeProviders.length}건`;
}

function updateVisibleColumns() {
  const activeProviders = getActiveProviders();
  const width = providerColumns.getBoundingClientRect().width;
  if (!width || !activeProviders.length) return;

  const nextVisibleCount = getResponsiveVisibleCount(activeProviders);

  if (nextVisibleCount !== visibleCount) {
    visibleCount = nextVisibleCount;
    renderScheduler({ resetWeights: true, preserveVisibleCount: true });
  } else {
    providerColumns.style.setProperty("--visible-columns", visibleCount);
    applyProviderGridColumns();
  }
}

function getResponsiveVisibleCount(activeProviders = getActiveProviders()) {
  if (!activeProviders.length) return 0;
  if (viewMode === "single") return 1;

  const width = providerColumns.getBoundingClientRect().width || schedulerPane.getBoundingClientRect().width;
  const mode = cardViewModes[viewMode];
  const nextCount = Math.floor((width + 12) / mode.targetWidth);
  return clamp(nextCount, 1, Math.min(mode.maxColumns, activeProviders.length));
}

function beginSlotSelection(event, index, providerId) {
  event.preventDefault();
  selectedSlot = clamp(index, 0, times.length - 2);
  selectionEndSlot = selectedSlot;
  selectedProviderId = providerId;
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
}

function movePage(direction) {
  const activeProviders = getActiveProviders();
  firstVisibleIndex = clamp(
    firstVisibleIndex + direction * visibleCount,
    0,
    Math.max(0, activeProviders.length - visibleCount),
  );
  renderScheduler({ resetWeights: true, preserveVisibleCount: true });
}

function installObservers() {
  const observer = new ResizeObserver(() => {
    const widths = getCurrentWidths();
    applyWidths(widths.left, widths.right, { store: false });
    updateVisibleColumns();
  });

  observer.observe(layout);
  observer.observe(schedulerPane);
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
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSortPopover();
    }
  });

  updateSortState();
}

function init() {
  renderDoctorList();
  renderTimeAxis();
  renderScheduler();
  attachResizeHandles();
  attachSortMenu();
  updateTimeFields();
  applyWidths(readStoredWidths().left, readStoredWidths().right, { store: false });
  installObservers();

  prevPageButton.addEventListener("click", () => movePage(-1));
  nextPageButton.addEventListener("click", () => movePage(1));
}

init();
