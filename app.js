(() => {
  "use strict";

  const STORAGE_KEY = "livelaunch-projects-v2";
  const LEGACY_KEY = "livelaunch-aurelia-v1";
  const AUTH_KEY = "livelaunch-auth-v1";
  const SESSION_KEY = "livelaunch-session-v1";
  const HOLD_DURATION = 10 * 60 * 1000;
  const SESSION_ID = `desk-${Math.random().toString(36).slice(2, 10)}`;
  const seedAgents = ["Ravi Shah", "Priya Menon", "Arjun Kapur", "Naina Das"];
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("livelaunch-sync") : null;

  const ui = {
    selectedUnit: null,
    tower: null,
    view: "inventory",
    activeCreativeId: null,
    filters: { tower: "all", status: "all", facing: "all", type: "all", floor: "all", budget: 320 },
    launchFilters: { facing: "all", type: "all", floor: "all", price: 320 }
  };

  let state = loadState();
  let authState = null;
  let currentUser = null;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character]));
  }

  function slug(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `project-${Date.now()}`;
  }

  function buildSeedProject() {
    const project = {
      id: "aurelia-skyline",
      name: "Aurelia",
      apartmentName: "Skyline",
      location: "Whitefield, Bengaluru",
      phase: "PHASE 01",
      towers: [
        { id: "A", name: "Altitude" },
        { id: "B", name: "Boulevard" },
        { id: "C", name: "Crest" }
      ],
      units: [],
      events: [],
      bookings: [],
      templates: [],
      creatives: [],
      auditLog: []
    };
    const facings = ["East", "Garden", "North", "West"];
    const types = ["2 BHK", "3 BHK", "3 BHK", "4 BHK"];
    const areas = [1280, 1640, 1785, 2160];
    let index = 0;

    project.towers.forEach((tower, towerIndex) => {
      for (let floor = 12; floor >= 5; floor -= 1) {
        for (let position = 1; position <= 4; position += 1) {
          const id = `${tower.id}${floor}${String(position).padStart(2, "0")}`;
          const priceLakhs = 112 + towerIndex * 17 + floor * 5 + position * 12;
          const sold = index % 9 === 1 || index % 13 === 4;
          const soldAt = sold ? Date.now() - ((index % 6) + 1) * 22 * 60 * 1000 : null;
          const soldBy = sold ? seedAgents[index % seedAgents.length] : null;
          project.units.push({
            id, tower: tower.id, floor, position, type: types[position - 1],
            area: areas[position - 1] + towerIndex * 18,
            facing: facings[(position + floor + towerIndex) % facings.length],
            priceLakhs, featured: !sold && (position === 4 || index % 15 === 0),
            state: sold ? "sold" : "available", heldBy: null, heldUntil: null,
            heldSession: null, soldBy, soldAt
          });
          if (sold) {
            project.events.push({ id: `seed-${id}`, unitId: id, agent: soldBy, priceLakhs, at: soldAt });
          }
          index += 1;
        }
      }
    });
    project.events.sort((left, right) => right.at - left.at);
    return project;
  }

  function createInitialState() {
    return { version: 2, currentProjectId: "aurelia-skyline", projects: [buildSeedProject()] };
  }

  function ensureProjectShape(item) {
    item.bookings ||= [];
    item.templates ||= [];
    item.creatives ||= [];
    item.auditLog ||= [];
    item.units ||= [];
    item.towers ||= [];
    item.events ||= [];
    item.units.forEach((unit) => {
      unit.type ||= "Apartment";
      unit.facing ||= "Not set";
    });
    if (!item.templates.length) {
      item.templates.push({
        id: "default-launch-template",
        name: "Project Launch Poster",
        type: "Project Launch Poster",
        image: "",
        uploadedBy: "System",
        uploadedAt: Date.now()
      });
    }
    return item;
  }

  function migrateLegacy(saved) {
    const project = buildSeedProject();
    if (saved && Array.isArray(saved.units)) {
      project.units = saved.units;
      project.events = Array.isArray(saved.events) ? saved.events : [];
    }
    return { version: 2, currentProjectId: project.id, projects: [project] };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && saved.version === 2 && Array.isArray(saved.projects) && saved.projects.length) {
        saved.projects.forEach(ensureProjectShape);
        return saved;
      }
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
      if (legacy && legacy.version === 1) {
        const migrated = migrateLegacy(legacy);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch (error) {
      console.warn("Could not read saved inventory.", error);
    }
    const initial = createInitialState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }

  function persist(message) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (channel) channel.postMessage({ type: "refresh", message });
  }

  async function hashPassword(password) {
    const bytes = new TextEncoder().encode(password);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function loginKey(loginId) {
    return String(loginId).trim().toLowerCase();
  }

  async function loadAuthState() {
    try {
      const saved = JSON.parse(localStorage.getItem(AUTH_KEY));
      if (saved && Array.isArray(saved.users) && saved.users.some((user) => user.role === "admin")) return saved;
    } catch (error) {
      console.warn("Could not read saved users.", error);
    }
    const initial = {
      initialPasswordActive: true,
      users: [{
        id: "admin",
        loginId: "admin",
        displayName: "Administrator",
        role: "admin",
        passwordHash: await hashPassword("Admin@123")
      }]
    };
    localStorage.setItem(AUTH_KEY, JSON.stringify(initial));
    return initial;
  }

  function persistAuth(message) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(authState));
    if (channel) channel.postMessage({ type: "auth-refresh", message });
  }

  function activeSalesPeople() {
    const namedUsers = authState ? authState.users.filter((user) => user.role === "sales" || user.role === "manager").map((user) => user.displayName) : [];
    const bookedNames = units().map((unit) => unit.soldBy).filter(Boolean);
    return [...new Set([...namedUsers, ...seedAgents, ...bookedNames])];
  }

  function project() {
    return ensureProjectShape(state.projects.find((item) => item.id === state.currentProjectId) || state.projects[0]);
  }

  function towers() {
    return project().towers;
  }

  function units() {
    return project().units;
  }

  function bookings() {
    return project().bookings;
  }

  function templates() {
    return project().templates;
  }

  function creatives() {
    return project().creatives;
  }

  function audit(message, meta = {}) {
    project().auditLog.unshift({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      message,
      user: currentUser ? currentUser.displayName : "System",
      role: currentUser ? currentUser.role : "system",
      at: Date.now(),
      meta
    });
    project().auditLog = project().auditLog.slice(0, 200);
  }

  function isAdmin() {
    return currentUser && currentUser.role === "admin";
  }

  function canManageTemplates() {
    return currentUser && (currentUser.role === "admin" || currentUser.role === "creative");
  }

  function canApproveCreatives() {
    return currentUser && (currentUser.role === "admin" || currentUser.role === "manager");
  }

  function agent() {
    return currentUser ? currentUser.displayName : "Unknown user";
  }

  function money(lakhs) {
    if (lakhs === null || lakhs === undefined || !Number.isFinite(Number(lakhs))) return "Price not set";
    return lakhs >= 100 ? `INR ${(lakhs / 100).toFixed(2)} Cr` : `INR ${Number(lakhs).toFixed(1)} L`;
  }

  function formatClock(milliseconds) {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function ordinal(number) {
    const tail = number % 100;
    if (tail >= 11 && tail <= 13) return `${number}th`;
    return `${number}${({ 1: "st", 2: "nd", 3: "rd" }[number % 10] || "th")}`;
  }

  function isToday(timestamp) {
    return Boolean(timestamp) && new Date(timestamp).toDateString() === new Date().toDateString();
  }

  function unitById(id) {
    return units().find((unit) => unit.id === id);
  }

  function towerName(id) {
    const tower = towers().find((item) => item.id === id);
    return tower ? tower.name : id;
  }

  function currentStatus(unit) {
    return unit.state === "available" && unit.featured ? "featured" : unit.state;
  }

  function statusName(unit) {
    return ({ available: "Available", held: "Reserved", sold: "Sold", featured: "Featured" })[currentStatus(unit)];
  }

  function availableUnits() {
    return units().filter((unit) => unit.state === "available");
  }

  function expireHolds() {
    let changed = false;
    units().forEach((unit) => {
      if (unit.state === "held" && unit.heldUntil && unit.heldUntil <= Date.now()) {
        Object.assign(unit, { state: "available", heldBy: null, heldUntil: null, heldSession: null });
        changed = true;
      }
    });
    if (changed) {
      persist("A reservation expired and returned to inventory.");
      showToast("A reservation expired and is available again.");
    }
    return changed;
  }

  function renderProjectPicker() {
    document.getElementById("project-select").innerHTML = state.projects.map((item) =>
      `<option value="${escapeHtml(item.id)}" ${item.id === project().id ? "selected" : ""}>${escapeHtml(item.name)} ${escapeHtml(item.apartmentName)}</option>`
    ).join("");
  }

  function renderProjectHeader() {
    const current = project();
    document.getElementById("project-phase").textContent = `NOW BOOKING | ${current.phase}`;
    document.getElementById("project-title").innerHTML = `${escapeHtml(current.name)} <span>${escapeHtml(current.apartmentName)}</span>`;
    document.getElementById("project-description").textContent =
      `Interactive sales inventory for ${current.towers.length} tower${current.towers.length === 1 ? "" : "s"} in ${current.location}.`;
    document.getElementById("launch-project-title").textContent = `${current.name} ${current.apartmentName} Launch Day`;
  }

  function renderTowerInputs() {
    const options = towers().map((tower) =>
      `<option value="${escapeHtml(tower.id)}">Tower ${escapeHtml(tower.id)} | ${escapeHtml(tower.name)}</option>`
    ).join("");
    const typeOptions = [...new Set(units().map((unit) => unit.type).filter(Boolean))].sort()
      .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
    const floorOptions = [...new Set(units().map((unit) => unit.floor).filter(Boolean))].sort((a, b) => a - b)
      .map((floor) => `<option value="${floor}">Floor ${floor}</option>`).join("");
    const facingOptions = ["East", "West", "North", "South", "North-East", "North-West", "South-East", "South-West", "Garden", "Not set"]
      .map((facing) => `<option value="${escapeHtml(facing)}">${escapeHtml(facing)}</option>`).join("");
    document.getElementById("tower-filter").innerHTML = `<option value="all">All towers</option>${options}`;
    document.getElementById("tower-filter").value =
      towers().some((tower) => tower.id === ui.filters.tower) ? ui.filters.tower : "all";
    document.getElementById("type-filter").innerHTML = `<option value="all">All types</option>${typeOptions}`;
    document.getElementById("type-filter").value = [...new Set(units().map((unit) => unit.type))].includes(ui.filters.type) ? ui.filters.type : "all";
    document.getElementById("floor-filter").innerHTML = `<option value="all">All floors</option>${floorOptions}`;
    document.getElementById("floor-filter").value = ui.filters.floor;
    document.getElementById("launch-facing-filter").innerHTML = `<option value="all">All facings</option>${facingOptions}`;
    document.getElementById("launch-facing-filter").value = ui.launchFilters.facing;
    document.getElementById("launch-type-filter").innerHTML = `<option value="all">All types</option>${typeOptions}`;
    document.getElementById("launch-type-filter").value = ui.launchFilters.type;
    document.getElementById("launch-floor-filter").innerHTML = `<option value="all">All floors</option>${floorOptions}`;
    document.getElementById("launch-floor-filter").value = ui.launchFilters.floor;
    document.getElementById("unit-tower-select").innerHTML = options || `<option value="">Add a tower first</option>`;
    document.getElementById("tower-form-context").textContent =
      `Adding to ${project().name} ${project().apartmentName}`;
  }

  function renderMetrics() {
    const total = units().length;
    const sold = units().filter((unit) => unit.state === "sold").length;
    const soldToday = units().filter((unit) => unit.state === "sold" && isToday(unit.soldAt)).length;
    const held = units().filter((unit) => unit.state === "held").length;
    const available = total - sold - held;
    const remaining = total ? Math.round((available / total) * 100) : 0;
    document.getElementById("metrics").innerHTML = `
      <div class="metric"><span class="metric-label">TOTAL UNITS</span><strong>${total}</strong></div>
      <div class="metric"><span class="metric-label">AVAILABLE</span><strong>${available}</strong><small class="positive">${remaining}% remaining</small></div>
      <div class="metric"><span class="metric-label">RESERVED</span><strong>${held}</strong></div>
      <div class="metric"><span class="metric-label">BOOKED</span><strong>${sold}</strong><small class="positive">${soldToday} confirmed today</small></div>`;
  }

  function renderBudgetControl() {
    const slider = document.getElementById("budget-filter");
    const highestPrice = units().reduce((maximum, unit) => Math.max(maximum, Number(unit.priceLakhs) || 0), 320);
    const max = Math.ceil(highestPrice / 5) * 5;
    slider.max = String(max);
    if (ui.filters.budget > max) ui.filters.budget = max;
    if (ui.launchFilters.price > max) ui.launchFilters.price = max;
    slider.value = String(ui.filters.budget);
    document.getElementById("budget-label").textContent = money(ui.filters.budget);
    const launchSlider = document.getElementById("launch-price-filter");
    launchSlider.max = String(max);
    launchSlider.value = String(ui.launchFilters.price);
    document.getElementById("launch-price-label").textContent = money(ui.launchFilters.price);
  }

  function renderTowerTabs() {
    document.getElementById("tower-tabs").innerHTML = towers().map((tower) => {
      const count = units().filter((unit) => unit.tower === tower.id && unit.state === "available").length;
      return `<button class="tower-tab ${ui.tower === tower.id ? "active" : ""}" data-tower="${escapeHtml(tower.id)}"><strong>Tower ${escapeHtml(tower.id)} | ${escapeHtml(tower.name)}</strong><small>${count} residences available</small></button>`;
    }).join("");
  }

  function unitMatchesFilters(unit) {
    return (ui.filters.tower === "all" || unit.tower === ui.filters.tower)
      && (ui.filters.facing === "all" || unit.facing === ui.filters.facing)
      && (ui.filters.type === "all" || unit.type === ui.filters.type)
      && (ui.filters.floor === "all" || String(unit.floor) === String(ui.filters.floor))
      && (!Number(unit.priceLakhs) || unit.priceLakhs <= ui.filters.budget)
      && (ui.filters.status === "all"
        || (ui.filters.status === "featured" ? unit.state === "available" && unit.featured : unit.state === ui.filters.status));
  }

  function unitMatchesLaunchFilters(unit) {
    return (ui.launchFilters.facing === "all" || unit.facing === ui.launchFilters.facing)
      && (ui.launchFilters.type === "all" || unit.type === ui.launchFilters.type)
      && (ui.launchFilters.floor === "all" || String(unit.floor) === String(ui.launchFilters.floor))
      && (!Number(unit.priceLakhs) || unit.priceLakhs <= ui.launchFilters.price);
  }

  function unitTooltip(unit) {
    return `${unit.id} | ${unit.facing} Facing\nTower ${unit.tower} | Floor ${unit.floor}\n${unit.type} | ${unit.area || "Not set"} Sq.ft\n${money(unit.priceLakhs)}\nStatus: ${statusName(unit)}`;
  }

  function renderGrid() {
    const targetTower = ui.filters.tower === "all" ? ui.tower : ui.filters.tower;
    const towerUnits = units().filter((unit) => unit.tower === targetTower);
    const visible = towerUnits.filter(unitMatchesFilters);
    const grid = document.getElementById("tower-grid");
    if (!towers().length) {
      grid.innerHTML = `<div class="no-units">No towers yet. An admin can add the first tower.</div>`;
      return;
    }
    if (!visible.length) {
      grid.innerHTML = `<div class="no-units">No units match the current preferences.</div>`;
      return;
    }
    const floors = [...new Set(towerUnits.map((unit) => unit.floor))].sort((a, b) => b - a);
    grid.innerHTML = floors.map((floor) => {
      const buttons = towerUnits.filter((unit) => unit.floor === floor).map((unit) => {
        if (!unitMatchesFilters(unit)) return "<span></span>";
        const status = currentStatus(unit);
        const badge = status === "featured" ? `<span class="unit-badge">PREMIUM</span>` : "";
        return `<button class="unit ${status} ${ui.selectedUnit === unit.id ? "selected" : ""}" data-unit="${escapeHtml(unit.id)}">${escapeHtml(unit.id)}${badge}</button>`;
      }).join("");
      return `<div class="floor-row dynamic"><span class="floor-label">FLOOR ${floor}</span><div class="floor-units">${buttons}</div></div>`;
    }).join("");
  }

  function renderRecommendations() {
    const recommended = units().filter((unit) => unit.state === "available" && unitMatchesFilters(unit))
      .sort((left, right) => Number(right.featured) - Number(left.featured) || right.floor - left.floor).slice(0, 3);
    document.getElementById("recommendations").innerHTML = recommended.length
      ? recommended.map((unit) => `<button class="recommendation" data-unit="${escapeHtml(unit.id)}">${escapeHtml(unit.id)}</button>`).join("")
      : `<span class="muted">Adjust filters to see matches</span>`;
  }

  function renderUnitPanel() {
    const panel = document.getElementById("unit-panel");
    const unit = unitById(ui.selectedUnit);
    if (!unit) {
      panel.innerHTML = `<div class="unit-panel-empty"><strong>Select a residence</strong><span>Explore price, orientation and reserve a unit live.</span></div>`;
      return;
    }
    const status = currentStatus(unit);
    const ownHold = unit.state === "held" && unit.heldSession === SESSION_ID && unit.heldBy === agent();
    const holdContent = unit.state === "held"
      ? unit.heldUntil
        ? `<div class="hold-message">Reserved by ${escapeHtml(unit.heldBy)}<br>Time Remaining: <strong>${formatClock(unit.heldUntil - Date.now())}</strong></div>`
        : `<div class="hold-message">Blocked in latest uploaded booking board</div>`
      : "";
    let actions = unit.state === "available" ? `<button class="primary-btn" id="hold-unit">Reserve for 10 Minutes</button>`
      : ownHold ? `<button class="primary-btn" id="confirm-unit">Confirm Booking</button><button class="secondary-btn" id="release-unit">Release Reservation</button>`
      : unit.state === "held" ? `<button class="secondary-btn" disabled>Currently Reserved</button>`
      : `<button class="secondary-btn" disabled>Booking Confirmed</button>`;
    if (isAdmin() && unit.state === "sold") {
      actions += `<button class="danger-btn" data-remove-booked="${escapeHtml(unit.id)}">Cancel Booking</button>`;
    }
    const booking = bookings().find((item) => item.unitId === unit.id);
    const bookingDetails = isAdmin() && booking ? `
      <div class="booking-detail-box">
        <strong>Booked By: ${escapeHtml(booking.customerName)}</strong>
        <span>Mobile: ${escapeHtml(booking.mobile)}</span>
        <span>Email: ${escapeHtml(booking.email || "Not provided")}</span>
        <span>Sales Executive: ${escapeHtml(booking.salesPerson)}</span>
        <span>Booking Amount: ${money(Number(booking.bookingAmount) / 100000 || 0)}</span>
        <span>Remarks: ${escapeHtml(booking.remarks || "None")}</span>
      </div>` : "";
    panel.innerHTML = `
      <div class="unit-heading">
        <div><p class="eyebrow">TOWER ${escapeHtml(unit.tower)} | FLOOR ${unit.floor}</p><h2>${escapeHtml(unit.id)}</h2></div>
        <span class="status-pill ${status}">${statusName(unit)}</span>
      </div>
      <div class="floor-plan" aria-label="Illustrative floor plan">
        <span class="plan-room room-living">LIVING</span><span class="plan-room room-bed">BEDROOM</span>
        <span class="plan-room room-kitchen">KITCHEN</span><span class="plan-room room-balcony">${escapeHtml(unit.facing.toUpperCase())} VIEW</span>
      </div>
      <div class="unit-specs">
        <div class="spec"><span>CONFIGURATION</span><strong>${escapeHtml(unit.type)}</strong></div>
        <div class="spec"><span>CARPET AREA</span><strong>${unit.area ? `${unit.area.toLocaleString("en-IN")} sq.ft` : "Not set"}</strong></div>
        <div class="spec"><span>FACING</span><strong>${escapeHtml(unit.facing)}</strong></div>
        <div class="spec"><span>FLOOR</span><strong>${ordinal(unit.floor)} Floor</strong></div>
      </div>
      <div class="price-box">
        <div class="price-total">${money(unit.priceLakhs)}</div>
        <div class="price-details"><div class="price-detail"><span>BASE PRICE</span><strong>${unit.priceLakhs ? money(Math.max(unit.priceLakhs - 12, 0)) : "Not set"}</strong></div>
        <div class="price-detail"><span>PREMIUM</span><strong>${unit.priceLakhs ? money(Math.min(unit.priceLakhs, 12)) : "Not set"}</strong></div></div>
      </div>${holdContent}${bookingDetails}<div class="panel-buttons">${actions}</div>`;
  }

  function renderLaunch() {
    const soldUnits = units().filter((unit) => unit.state === "sold");
    const held = units().filter((unit) => unit.state === "held").length;
    const available = units().length - soldUnits.length - held;
    document.getElementById("launch-metrics").innerHTML = `
      <article class="launch-stat"><span>TOTAL UNITS</span><strong>${units().length}</strong></article>
      <article class="launch-stat"><span>AVAILABLE UNITS</span><strong>${available}</strong></article>
      <article class="launch-stat"><span>RESERVED UNITS</span><strong>${held}</strong></article>
      <article class="launch-stat"><span>BOOKED UNITS</span><strong>${soldUnits.length}</strong></article>`;
    document.getElementById("heatmap").innerHTML = towers().map((tower) => {
      const towerUnits = units().filter((unit) => unit.tower === tower.id && unitMatchesLaunchFilters(unit));
      const floors = [...new Set(towerUnits.map((unit) => unit.floor))].sort((a, b) => b - a);
      const cells = floors.map((floor) => `<div class="heat-floor">${towerUnits.filter((unit) => unit.floor === floor)
        .map((unit) => `<button title="${escapeHtml(unitTooltip(unit))}" class="heat-unit ${unit.state}" data-unit="${escapeHtml(unit.id)}"><strong>${escapeHtml(unit.id)}</strong><span>${escapeHtml(unit.facing)} Facing</span></button>`).join("")}</div>`).join("");
      return `<div class="heat-tower"><h4>Tower ${escapeHtml(tower.id)} | ${escapeHtml(tower.name)}</h4>${cells || `<p class="muted">No matching units.</p>`}</div>`;
    }).join("") || `<p class="muted">No towers configured.</p>`;
  }

  function renderInsights() {
    const soldToday = units().filter((unit) => unit.state === "sold" && isToday(unit.soldAt));
    const todayBookings = bookings().filter((booking) => isToday(booking.createdAt));
    const pending = creatives().filter((creative) => creative.status === "Pending Approval").length;
    const approved = creatives().filter((creative) => creative.approvalStatus === "Approved").length;
    const whatsApp = (status) => creatives().filter((creative) => creative.whatsappStatus === status).length;
    document.getElementById("dashboard-cards").innerHTML = [
      ["Today's Bookings", todayBookings.length],
      ["Creative Requests", creatives().length],
      ["Pending Approvals", pending],
      ["Approved Creatives", approved],
      ["WhatsApp Sent", creatives().filter((creative) => creative.whatsappStatus !== "Not Sent").length],
      ["WhatsApp Delivered", whatsApp("Delivered") + whatsApp("Read")],
      ["WhatsApp Read", whatsApp("Read")]
    ].map(([label, value]) => `<article class="dashboard-card"><span>${label}</span><strong>${value}</strong></article>`).join("");
    document.getElementById("revenue-total").textContent = money(soldToday.reduce((sum, unit) => sum + unit.priceLakhs, 0));
    document.getElementById("hold-total").textContent = String(units().filter((unit) => unit.state === "held").length).padStart(2, "0");
    document.getElementById("tower-bars").innerHTML = towers().map((tower) => {
      const total = units().filter((unit) => unit.tower === tower.id).length;
      const sold = soldToday.filter((unit) => unit.tower === tower.id).length;
      const percentage = total ? Math.round((sold / total) * 100) : 0;
      return `<div class="bar-row"><strong>Tower ${escapeHtml(tower.id)}</strong><div class="bar-track"><div class="bar-fill" style="width: ${percentage}%"></div></div><span>${percentage}%</span></div>`;
    }).join("") || `<p class="muted">No inventory configured yet.</p>`;
    renderBarSet("facing-bars", groupCounts(units().filter((unit) => unit.state === "sold"), "facing"));
    renderBarSet("creative-trend-bars", groupCounts(creatives(), (creative) => creative.bookingDate || "No date"));
    renderBarSet("sales-performance-bars", groupCounts(bookings(), "salesPerson"));
  }

  function groupCounts(items, key) {
    return items.reduce((map, item) => {
      const label = typeof key === "function" ? key(item) : item[key];
      map[label || "Unknown"] = (map[label || "Unknown"] || 0) + 1;
      return map;
    }, {});
  }

  function renderBarSet(id, counts) {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const max = Math.max(1, ...entries.map((entry) => entry[1]));
    document.getElementById(id).innerHTML = entries.length ? entries.map(([label, count]) =>
      `<div class="bar-row"><strong>${escapeHtml(label)}</strong><div class="bar-track"><div class="bar-fill" style="width: ${Math.round((count / max) * 100)}%"></div></div><span>${count}</span></div>`
    ).join("") : `<p class="muted">No data yet.</p>`;
  }

  function renderAdmin() {
    const available = isAdmin();
    document.querySelectorAll(".admin-only").forEach((element) => element.classList.toggle("visible", available));
    if (!available && ui.view === "admin") switchView("inventory");
    document.getElementById("import-project-name").textContent = `${project().name} ${project().apartmentName}`;
    const booked = units().filter((unit) => unit.state === "sold");
    document.getElementById("booked-unit-list").innerHTML = booked.length ? booked.map((unit) =>
      `<div class="booked-row"><div><strong>${escapeHtml(unit.id)}</strong><small>${escapeHtml(unit.soldBy || "Booked")}</small></div><button class="danger-link" data-remove-booked="${escapeHtml(unit.id)}">Cancel</button></div>`
    ).join("") : `<p class="muted">No booked units in this project.</p>`;
    document.getElementById("user-list").innerHTML = authState.users.map((user) => `
      <div class="login-row">
        <div><strong>${escapeHtml(user.displayName)}</strong><small>${escapeHtml(user.loginId)}</small><span class="role-pill">${escapeHtml(roleLabel(user.role))}</span></div>
        ${user.role !== "admin" ? `<button class="danger-link" data-remove-user="${escapeHtml(user.id)}">Remove</button>` : ""}
      </div>`).join("");
    document.getElementById("audit-list").innerHTML = project().auditLog.slice(0, 12).map((entry) => `
      <div class="audit-row"><strong>${escapeHtml(entry.message)}</strong><span>${escapeHtml(entry.user)} | ${new Date(entry.at).toLocaleString()}</span></div>`).join("") || `<p class="muted">No audit activity yet.</p>`;
  }

  function roleLabel(role) {
    return ({ admin: "Admin", creative: "Creative Team", manager: "Sales Manager", sales: "Sales User" })[role] || role;
  }

  function renderClock() {
    document.getElementById("launch-clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function renderSession() {
    const authenticated = Boolean(currentUser);
    document.getElementById("auth-screen").classList.toggle("hidden", authenticated);
    document.getElementById("app-shell").classList.toggle("locked", !authenticated);
    document.getElementById("first-login-hint").hidden = authState && authState.initialPasswordActive === false;
    document.querySelectorAll(".approval-access").forEach((item) => item.classList.toggle("visible", canApproveCreatives()));
    document.querySelectorAll(".template-admin-only").forEach((item) => item.style.display = canManageTemplates() ? "block" : "none");
    if (authenticated) {
      document.getElementById("account-badge").textContent = `${currentUser.displayName} | ${currentUser.role === "admin" ? "Admin" : "Sales"}`;
      document.getElementById("login-error").textContent = "";
    }
  }

  function resetProjectUi() {
    ui.selectedUnit = null;
    ui.tower = towers()[0] ? towers()[0].id : null;
    ui.filters.tower = "all";
    document.getElementById("status-filter").value = "all";
    document.getElementById("facing-filter").value = "all";
    document.getElementById("type-filter").value = "all";
    document.getElementById("floor-filter").value = "all";
    ui.filters.status = "all";
    ui.filters.facing = "all";
    ui.filters.type = "all";
    ui.filters.floor = "all";
    ui.filters.budget = 100000;
    ui.launchFilters = { facing: "all", type: "all", floor: "all", price: 100000 };
  }

  function renderAll() {
    if (!project()) return;
    if (!ui.tower || !towers().some((tower) => tower.id === ui.tower)) ui.tower = towers()[0] ? towers()[0].id : null;
    renderProjectPicker();
    renderProjectHeader();
    renderTowerInputs();
    renderBudgetControl();
    renderMetrics();
    renderTowerTabs();
    renderGrid();
    renderRecommendations();
    renderUnitPanel();
    renderLaunch();
    renderInsights();
    renderStudio();
    renderApprovals();
    renderHistory();
    renderAdmin();
    renderClock();
  }

  function selectUnit(id) {
    const unit = unitById(id);
    if (!unit) return;
    ui.selectedUnit = id;
    ui.tower = unit.tower;
    if (ui.filters.tower !== "all" && ui.filters.tower !== unit.tower) ui.filters.tower = unit.tower;
    renderTowerInputs();
    renderTowerTabs();
    renderGrid();
    renderUnitPanel();
  }

  function reserveSelected() {
    const unit = unitById(ui.selectedUnit);
    if (!unit || unit.state !== "available") return;
    Object.assign(unit, { state: "held", heldBy: agent(), heldUntil: Date.now() + HOLD_DURATION, heldSession: SESSION_ID });
    persist(`${unit.id} reserved by ${unit.heldBy}.`);
    showToast(`${unit.id} reserved for ${unit.heldBy}.`);
    renderAll();
  }

  function confirmSelected() {
    const unit = unitById(ui.selectedUnit);
    if (!unit || unit.state !== "held" || unit.heldSession !== SESSION_ID || unit.heldBy !== agent()) return;
    openBookingForm(unit);
  }

  function openBookingForm(unit) {
    const form = document.getElementById("booking-form");
    form.unitId.value = unit.id;
    form.unitNumber.value = unit.id;
    form.tower.value = unit.tower;
    form.salesPerson.value = agent();
    form.bookingDate.value = new Date().toISOString().slice(0, 10);
    form.bookingAmount.value = unit.priceLakhs ? Math.round(unit.priceLakhs * 100000) : 0;
    document.getElementById("booking-modal").classList.remove("hidden");
    form.customerName.focus();
  }

  function finalizeBooking(form) {
    const data = new FormData(form);
    const unit = unitById(String(data.get("unitId")));
    if (!unit || unit.state !== "held" || unit.heldSession !== SESSION_ID || unit.heldBy !== agent()) return;
    Object.assign(unit, { state: "sold", soldBy: unit.heldBy, soldAt: Date.now(), heldUntil: null, heldSession: null });
    const booking = {
      id: `booking-${Date.now()}`,
      unitId: unit.id,
      tower: unit.tower,
      customerName: String(data.get("customerName")).trim(),
      mobile: String(data.get("mobile")).trim(),
      email: String(data.get("email")).trim(),
      bookingDate: String(data.get("bookingDate")),
      salesPerson: String(data.get("salesPerson")),
      bookingAmount: Number(data.get("bookingAmount")) || 0,
      remarks: String(data.get("remarks")).trim(),
      createdAt: Date.now(),
      createdBy: agent()
    };
    project().bookings = bookings().filter((item) => item.unitId !== unit.id);
    project().bookings.unshift(booking);
    project().events.unshift({ id: `event-${Date.now()}`, unitId: unit.id, agent: unit.soldBy, priceLakhs: unit.priceLakhs, at: unit.soldAt });
    audit(`Booking confirmed for ${unit.id}`, { bookingId: booking.id, customerName: booking.customerName });
    persist(`${unit.id} booking confirmed.`);
    showToast(`${unit.id} is sold. The live screens are updated.`);
    document.getElementById("booking-modal").classList.add("hidden");
    form.reset();
    renderAll();
  }

  function releaseSelected() {
    const unit = unitById(ui.selectedUnit);
    if (!unit || unit.state !== "held" || unit.heldSession !== SESSION_ID || unit.heldBy !== agent()) return;
    Object.assign(unit, { state: "available", heldBy: null, heldUntil: null, heldSession: null });
    persist(`${unit.id} released.`);
    showToast(`${unit.id} returned to availability.`);
    renderAll();
  }

  function removeBookedUnit(id) {
    if (!isAdmin()) return;
    const unit = unitById(id);
    if (!unit || unit.state !== "sold") return;
    Object.assign(unit, { state: "available", soldBy: null, soldAt: null, heldBy: null, heldUntil: null, heldSession: null });
    project().events = project().events.filter((event) => event.unitId !== id);
    project().bookings = bookings().filter((booking) => booking.unitId !== id);
    audit(`Booking cancelled for ${id}`);
    persist(`${id} booking cancelled by administrator.`);
    showToast(`Booking cancelled. ${id} is available again.`);
    renderAll();
  }

  function simulateBooking() {
    const candidates = availableUnits();
    if (!candidates.length) return;
    const unit = candidates[Math.floor(Math.random() * candidates.length)];
    const sellers = activeSalesPeople();
    Object.assign(unit, { state: "sold", soldBy: sellers[Math.floor(Math.random() * sellers.length)] || "Sales Team", soldAt: Date.now() });
    project().events.unshift({ id: `simulation-${Date.now()}`, unitId: unit.id, agent: unit.soldBy, priceLakhs: unit.priceLakhs, at: unit.soldAt });
    persist(`${unit.id} booked on another sales screen.`);
    showToast(`Live booking: ${unit.id} confirmed by ${unit.soldBy}.`);
    renderAll();
  }

  function switchView(view) {
    if (view === "admin" && !isAdmin()) return;
    if (view === "approvals" && !canApproveCreatives()) return;
    ui.view = view;
    document.querySelectorAll(".nav-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
    document.querySelectorAll(".view").forEach((section) => section.classList.remove("active"));
    document.getElementById(`${view}-view`).classList.add("active");
  }

  function showToast(message) {
    const target = document.getElementById("toast-region");
    target.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { target.innerHTML = ""; }, 3600);
  }

  function showImportReport(message, type) {
    const report = document.getElementById("import-report");
    report.textContent = message;
    report.className = `import-report ${type || ""}`.trim();
  }

  function renderStudio() {
    const templateOptions = templates().map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join("");
    document.getElementById("template-select").innerHTML = templateOptions;
    const form = document.getElementById("creative-form");
    if (!form.projectName.value) form.projectName.value = `${project().name} ${project().apartmentName}`;
    if (!form.salesPerson.value) form.salesPerson.value = agent();
    if (!form.bookingDate.value) form.bookingDate.value = new Date().toISOString().slice(0, 10);
    updateCreativePreview();
  }

  function selectedTemplate() {
    const id = document.getElementById("template-select").value;
    return templates().find((template) => template.id === id) || templates()[0];
  }

  function updateCreativePreview() {
    const template = selectedTemplate();
    const image = document.getElementById("template-preview-image");
    image.src = template && template.image ? template.image : "";
    image.style.display = template && template.image ? "block" : "none";
    const photo = document.getElementById("customer-photo-preview");
    const brightness = document.getElementById("photo-brightness").value;
    const contrast = document.getElementById("photo-contrast").value;
    const saturation = document.getElementById("photo-saturation").value;
    const zoom = document.getElementById("photo-zoom").value;
    const rotate = document.getElementById("photo-rotate").value;
    const x = document.getElementById("photo-x").value;
    const y = document.getElementById("photo-y").value;
    photo.style.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
    photo.style.transform = `translate(${x}px, ${y}px) scale(${Number(zoom) / 100}) rotate(${rotate}deg)`;
    document.querySelector(".photo-holder").className = `photo-holder ${document.getElementById("photo-crop").value.toLowerCase().replace(/\s+/g, "-")}`;
    const form = document.getElementById("creative-form");
    document.getElementById("preview-customer-name").textContent = form.customerName.value || "Customer Name";
    document.getElementById("preview-unit-text").textContent = `${form.unitNumber.value || "Unit"} | ${form.facing.value || "Facing"} Facing`;
    document.getElementById("preview-project-text").textContent = form.projectName.value || `${project().name} ${project().apartmentName}`;
    document.getElementById("preview-sales-text").textContent = form.salesPerson.value || agent();
  }

  function currentCreativePayload(status = "Draft") {
    const form = document.getElementById("creative-form");
    const template = selectedTemplate();
    return {
      id: ui.activeCreativeId || `creative-${Date.now()}`,
      templateId: template ? template.id : "",
      templateName: template ? template.name : "Default Template",
      customerPhoto: document.getElementById("customer-photo-preview").src || "",
      customerName: form.customerName.value.trim(),
      unitNumber: form.unitNumber.value.trim(),
      towerName: form.towerName.value.trim(),
      facing: form.facing.value.trim(),
      projectName: form.projectName.value.trim(),
      salesPerson: form.salesPerson.value.trim(),
      bookingDate: form.bookingDate.value,
      status,
      approvalStatus: status === "Pending Approval" ? "Pending Approval" : status,
      whatsappStatus: "Not Sent",
      createdBy: agent(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      audit: [{ action: status, by: agent(), at: Date.now() }]
    };
  }

  function saveCreative(status = "Draft") {
    const payload = currentCreativePayload(status);
    const existing = creatives().find((creative) => creative.id === payload.id);
    if (existing) Object.assign(existing, payload, { createdAt: existing.createdAt, audit: [...existing.audit, ...payload.audit] });
    else creatives().unshift(payload);
    ui.activeCreativeId = payload.id;
    audit(`Creative ${status.toLowerCase()} for ${payload.customerName || payload.unitNumber}`, { creativeId: payload.id });
    persist(`Creative saved as ${status}.`);
    renderAll();
    return payload;
  }

  function renderApprovals() {
    const list = creatives().filter((creative) => creative.status === "Pending Approval");
    document.getElementById("approval-list").innerHTML = list.map((creative) => creativeCard(creative, true)).join("") || `<p class="muted">No creatives pending approval.</p>`;
  }

  function renderHistory() {
    const customer = document.getElementById("history-customer-filter").value.toLowerCase();
    const projectFilter = document.getElementById("history-project-filter").value.toLowerCase();
    const sales = document.getElementById("history-sales-filter").value.toLowerCase();
    const date = document.getElementById("history-date-filter").value;
    const filtered = creatives().filter((creative) =>
      (!customer || creative.customerName.toLowerCase().includes(customer))
      && (!projectFilter || creative.projectName.toLowerCase().includes(projectFilter))
      && (!sales || creative.salesPerson.toLowerCase().includes(sales))
      && (!date || creative.bookingDate === date));
    document.getElementById("creative-history-list").innerHTML = filtered.map((creative) => creativeCard(creative, false)).join("") || `<p class="muted">No creative history yet.</p>`;
  }

  function creativeCard(creative, approvalMode) {
    return `<article class="creative-card">
      <div class="creative-thumb">${creative.customerPhoto ? `<img src="${escapeHtml(creative.customerPhoto)}" alt="">` : `<span>No Photo</span>`}</div>
      <h3>${escapeHtml(creative.customerName || "Unnamed Customer")}</h3>
      <p>${escapeHtml(creative.unitNumber)} | ${escapeHtml(creative.facing)} Facing</p>
      <p><strong>Status:</strong> ${escapeHtml(creative.status)}<br><strong>Approval:</strong> ${escapeHtml(creative.approvalStatus)}<br><strong>WhatsApp:</strong> ${escapeHtml(creative.whatsappStatus)}</p>
      <div class="card-actions">
        <button class="secondary-btn" data-view-creative="${escapeHtml(creative.id)}">View</button>
        <button class="secondary-btn" data-download-creative="${escapeHtml(creative.id)}">Download</button>
        ${approvalMode ? `<button class="primary-btn" data-approve-creative="${escapeHtml(creative.id)}">Approve</button><button class="danger-btn" data-reject-creative="${escapeHtml(creative.id)}">Reject</button>` : ""}
        ${creative.status === "Approved" || creative.status === "Sent to Customer" ? `<button class="secondary-btn" data-resend-creative="${escapeHtml(creative.id)}">Resend</button>` : ""}
      </div>
    </article>`;
  }

  function approveCreative(id) {
    const creative = creatives().find((item) => item.id === id);
    if (!creative || !canApproveCreatives()) return;
    Object.assign(creative, {
      status: "Approved",
      approvalStatus: "Approved",
      approvedBy: agent(),
      approvedAt: Date.now()
    });
    creative.audit.push({ action: "Approved", by: agent(), at: Date.now() });
    audit(`Creative approved for ${creative.customerName}`, { creativeId: id });
    sendWhatsApp(creative);
  }

  function rejectCreative(id) {
    const creative = creatives().find((item) => item.id === id);
    if (!creative || !canApproveCreatives()) return;
    Object.assign(creative, { status: "Draft", approvalStatus: "Rejected" });
    creative.audit.push({ action: "Rejected - Edit Again", by: agent(), at: Date.now() });
    audit(`Creative rejected for ${creative.customerName}`, { creativeId: id });
    persist("Creative rejected for editing.");
    renderAll();
  }

  function sendWhatsApp(creative) {
    Object.assign(creative, { status: "Sent to Customer", whatsappStatus: "Sent", whatsappSentAt: Date.now() });
    creative.audit.push({ action: "WhatsApp Sent", by: "Meta Cloud API Simulator", at: Date.now() });
    persist(`WhatsApp sent to ${creative.customerName}.`);
    renderAll();
    setTimeout(() => updateWhatsAppStatus(creative.id, "Delivered"), 900);
    setTimeout(() => updateWhatsAppStatus(creative.id, "Read"), 1800);
  }

  function updateWhatsAppStatus(id, status) {
    const creative = creatives().find((item) => item.id === id);
    if (!creative) return;
    creative.whatsappStatus = status;
    creative[`whatsapp${status}At`] = Date.now();
    creative.audit.push({ action: `WhatsApp ${status}`, by: "Meta Cloud API Simulator", at: Date.now() });
    persist(`WhatsApp ${status.toLowerCase()} for ${creative.customerName}.`);
    renderAll();
  }

  function loadCreative(id) {
    const creative = creatives().find((item) => item.id === id);
    if (!creative) return;
    ui.activeCreativeId = id;
    const form = document.getElementById("creative-form");
    ["customerName", "unitNumber", "towerName", "facing", "projectName", "salesPerson", "bookingDate"].forEach((name) => {
      form[name].value = creative[name] || "";
    });
    document.getElementById("customer-photo-preview").src = creative.customerPhoto || "";
    switchView("studio");
    updateCreativePreview();
  }

  function downloadCreative(id) {
    const creative = creatives().find((item) => item.id === id);
    if (!creative) return;
    const blob = new Blob([JSON.stringify(creative, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${creative.customerName || "creative"}-${creative.unitNumber || "unit"}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const next = text[index + 1];
      if (character === '"' && quoted && next === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === "," && !quoted) {
        row.push(value);
        value = "";
      } else if ((character === "\n" || character === "\r") && !quoted) {
        if (character === "\r" && next === "\n") index += 1;
        row.push(value);
        if (row.some((cell) => String(cell).trim())) rows.push(row);
        row = [];
        value = "";
      } else {
        value += character;
      }
    }
    row.push(value);
    if (row.some((cell) => String(cell).trim())) rows.push(row);
    return rows;
  }

  function zipEntries(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const decoder = new TextDecoder();
    let end = bytes.length - 22;
    while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
    if (end < 0) throw new Error("Invalid XLSX file.");
    const totalEntries = view.getUint16(end + 10, true);
    let offset = view.getUint32(end + 16, true);
    const entries = [];
    for (let count = 0; count < totalEntries; count += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Invalid XLSX directory.");
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      entries.push({ name, method, bytes: bytes.slice(start, start + compressedSize) });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  async function inflateEntry(entry) {
    if (entry.method === 0) return entry.bytes;
    if (entry.method !== 8 || typeof DecompressionStream === "undefined") {
      throw new Error("This spreadsheet compression is not supported in your browser.");
    }
    const stream = new Blob([entry.bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function parseXlsx(buffer) {
    const decoder = new TextDecoder();
    const fileMap = new Map();
    for (const entry of zipEntries(buffer)) {
      fileMap.set(entry.name.replace(/^\/+/, ""), decoder.decode(await inflateEntry(entry)));
    }
    const sharedXml = fileMap.get("xl/sharedStrings.xml");
    const parser = new DOMParser();
    const sharedStrings = sharedXml
      ? [...parser.parseFromString(sharedXml, "application/xml").querySelectorAll("si")].map((item) => item.textContent)
      : [];
    const workbook = parser.parseFromString(fileMap.get("xl/workbook.xml") || "", "application/xml");
    const firstSheet = workbook.querySelector("sheet");
    if (!firstSheet) throw new Error("Spreadsheet has no worksheet.");
    const relationshipId = firstSheet.getAttribute("r:id") || firstSheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const relationships = parser.parseFromString(fileMap.get("xl/_rels/workbook.xml.rels") || "", "application/xml");
    const relationship = [...relationships.querySelectorAll("Relationship")].find((item) => item.getAttribute("Id") === relationshipId);
    const target = relationship ? relationship.getAttribute("Target") : "worksheets/sheet1.xml";
    const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const sheetXml = fileMap.get(sheetPath);
    if (!sheetXml) throw new Error("Could not read the first worksheet.");
    const sheet = parser.parseFromString(sheetXml, "application/xml");
    return [...sheet.querySelectorAll("sheetData row")].map((xmlRow) => {
      const row = [];
      xmlRow.querySelectorAll("c").forEach((cell) => {
        const reference = cell.getAttribute("r") || "";
        const letters = (reference.match(/^[A-Z]+/i) || ["A"])[0].toUpperCase();
        let column = 0;
        for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64;
        const raw = cell.querySelector("v") ? cell.querySelector("v").textContent : cell.textContent;
        row[column - 1] = cell.getAttribute("t") === "s" ? sharedStrings[Number(raw)] : raw;
      });
      return row;
    });
  }

  function normalizedHeading(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function rowsToImportedUnits(rows) {
    const headerIndex = rows.findIndex((row) => {
      const headings = row.map(normalizedHeading);
      return headings.includes("UNITNO") && headings.some((value) => value === "AVAILABILITY" || value === "AVAILABLITY");
    });
    if (headerIndex < 0) throw new Error("Could not find Unit No and Availability columns.");
    const headings = rows[headerIndex].map(normalizedHeading);
    const column = (...names) => headings.findIndex((heading) => names.includes(heading));
    const towerColumn = column("BLOCK", "TOWER");
    const floorColumn = column("FLOOR");
    const unitColumn = column("UNITNO", "UNITNUMBER");
    const facingColumn = column("FACING", "DIRECTION");
    const statusColumn = column("AVAILABILITY", "AVAILABLITY", "STATUS");
    if (towerColumn < 0 || floorColumn < 0 || unitColumn < 0 || statusColumn < 0) {
      throw new Error("Sheet requires Block/Tower, Floor, Unit No, and Availability columns.");
    }
    return rows.slice(headerIndex + 1).map((row) => {
      const id = String(row[unitColumn] || "").trim().toUpperCase();
      const tower = String(row[towerColumn] || "").trim().toUpperCase();
      const floor = Number(String(row[floorColumn] || "").trim());
      if (!id || !tower || !Number.isFinite(floor)) return null;
      const importedStatus = String(row[statusColumn] || "").trim().toUpperCase();
      const stateName = importedStatus.includes("BOOKED") ? "sold" : importedStatus.includes("BLOCKED") ? "held" : "available";
      const facing = String(row[facingColumn] || "").trim().toLowerCase();
      return {
        id,
        tower,
        floor,
        facing: facing ? facing.charAt(0).toUpperCase() + facing.slice(1) : "Not set",
        state: stateName
      };
    }).filter(Boolean);
  }

  function synchronizeImportedUnits(importedUnits, replaceMissing) {
    const current = project();
    const previous = new Map(current.units.map((unit) => [unit.id, unit]));
    const importedIds = new Set();
    const counts = { available: 0, held: 0, sold: 0, created: 0, updated: 0 };
    const updatedUnits = importedUnits.map((imported, index) => {
      const existing = previous.get(imported.id);
      importedIds.add(imported.id);
      counts[imported.state] += 1;
      counts[existing ? "updated" : "created"] += 1;
      const unit = existing || {
        id: imported.id, type: "Apartment", area: null, priceLakhs: null,
        featured: false, position: index + 1
      };
      const statusFields = imported.state === "sold"
        ? { state: "sold", soldBy: existing && existing.state === "sold" ? existing.soldBy : "Imported booking board", soldAt: existing && existing.state === "sold" ? existing.soldAt : null, heldBy: null, heldUntil: null, heldSession: null }
        : imported.state === "held"
          ? { state: "held", heldBy: "Blocked in booking board", heldUntil: null, heldSession: null, soldBy: null, soldAt: null }
          : { state: "available", heldBy: null, heldUntil: null, heldSession: null, soldBy: null, soldAt: null };
      return { ...unit, tower: imported.tower, floor: imported.floor, facing: imported.facing, ...statusFields };
    });
    const retained = replaceMissing ? [] : current.units.filter((unit) => !importedIds.has(unit.id));
    current.units = [...updatedUnits, ...retained];
    importedUnits.forEach((unit) => {
      if (!current.towers.some((tower) => tower.id === unit.tower)) {
        current.towers.push({ id: unit.tower, name: `Block ${unit.tower}` });
      }
    });
    if (replaceMissing) {
      const resultingUnits = new Map(current.units.map((unit) => [unit.id, unit]));
      current.events = current.events.filter((event) => resultingUnits.get(event.unitId)?.state === "sold");
    }
    return counts;
  }

  async function importInventoryFile(file) {
    if (!isAdmin()) return;
    showImportReport(`Reading ${file.name}...`, "");
    try {
      const lowerName = file.name.toLowerCase();
      const rows = lowerName.endsWith(".csv") ? parseCsv(await file.text()) : await parseXlsx(await file.arrayBuffer());
      const imported = rowsToImportedUnits(rows);
      if (!imported.length) throw new Error("No inventory rows were found.");
      const counts = synchronizeImportedUnits(imported, document.getElementById("replace-import").checked);
      resetProjectUi();
      persist(`${file.name} imported by administrator.`);
      renderAll();
      showImportReport(`${file.name}: ${imported.length} units updated (${counts.available} available, ${counts.held} blocked, ${counts.sold} booked).`, "success");
      showToast(`${imported.length} units updated from booking board.`);
    } catch (error) {
      showImportReport(`Import failed: ${error.message}`, "error");
    }
  }

  document.addEventListener("click", (event) => {
    const unitButton = event.target.closest("[data-unit]");
    const towerButton = event.target.closest("[data-tower]");
    const viewButton = event.target.closest("[data-view]");
    const removeButton = event.target.closest("[data-remove-booked]");
    const removeUserButton = event.target.closest("[data-remove-user]");
    const approveButton = event.target.closest("[data-approve-creative]");
    const rejectButton = event.target.closest("[data-reject-creative]");
    const viewCreativeButton = event.target.closest("[data-view-creative]");
    const downloadCreativeButton = event.target.closest("[data-download-creative]");
    const resendCreativeButton = event.target.closest("[data-resend-creative]");
    if (unitButton) return selectUnit(unitButton.dataset.unit);
    if (towerButton) {
      ui.tower = towerButton.dataset.tower;
      renderTowerTabs();
      renderGrid();
      return;
    }
    if (viewButton) return switchView(viewButton.dataset.view);
    if (removeButton) return removeBookedUnit(removeButton.dataset.removeBooked);
    if (approveButton) return approveCreative(approveButton.dataset.approveCreative);
    if (rejectButton) return rejectCreative(rejectButton.dataset.rejectCreative);
    if (viewCreativeButton) return loadCreative(viewCreativeButton.dataset.viewCreative);
    if (downloadCreativeButton) return downloadCreative(downloadCreativeButton.dataset.downloadCreative);
    if (resendCreativeButton) {
      const creative = creatives().find((item) => item.id === resendCreativeButton.dataset.resendCreative);
      if (creative) sendWhatsApp(creative);
      return;
    }
    if (removeUserButton && isAdmin()) {
      const removed = authState.users.find((user) => user.id === removeUserButton.dataset.removeUser && user.role === "sales");
      if (!removed) return;
      authState.users = authState.users.filter((user) => user.id !== removed.id);
      audit(`User removed: ${removed.displayName}`);
      persistAuth(`${removed.displayName} login removed by administrator.`);
      showToast(`${removed.displayName} login removed.`);
      renderAdmin();
      renderLaunch();
      return;
    }
    if (event.target.closest("[data-open-launch]")) switchView("launch");
    if (event.target.closest("#hold-unit")) reserveSelected();
    if (event.target.closest("#confirm-unit")) confirmSelected();
    if (event.target.closest("#release-unit")) releaseSelected();
    if (event.target.closest("#simulate-sale")) simulateBooking();
    if (event.target.closest("#delete-project") && isAdmin()) {
      if (state.projects.length === 1) return showToast("At least one project must remain.");
      const removed = project();
      if (!window.confirm(`Delete ${removed.name} ${removed.apartmentName}?`)) return;
      state.projects = state.projects.filter((item) => item.id !== removed.id);
      state.currentProjectId = state.projects[0].id;
      resetProjectUi();
      persist("Project removed by administrator.");
      showToast("Project deleted.");
      renderAll();
    }
  });

  document.getElementById("project-select").addEventListener("change", (event) => {
    state.currentProjectId = event.target.value;
    resetProjectUi();
    persist("Selected project changed.");
    renderAll();
  });

  document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const loginId = loginKey(data.get("loginId"));
    const passwordHash = await hashPassword(String(data.get("password")));
    const user = authState.users.find((item) => loginKey(item.loginId) === loginId && item.passwordHash === passwordHash);
    if (!user) {
      document.getElementById("login-error").textContent = "Incorrect login ID or password.";
      return;
    }
    currentUser = user;
    sessionStorage.setItem(SESSION_KEY, user.id);
    event.target.reset();
    resetProjectUi();
    renderSession();
    expireHolds();
    renderAll();
  });

  document.getElementById("logout-button").addEventListener("click", () => {
    currentUser = null;
    sessionStorage.removeItem(SESSION_KEY);
    switchView("inventory");
    renderSession();
  });

  document.getElementById("inventory-upload").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) importInventoryFile(file);
    event.target.value = "";
  });

  ["tower", "status", "facing", "type", "floor"].forEach((name) => {
    document.getElementById(`${name}-filter`).addEventListener("change", (event) => {
      ui.filters[name] = event.target.value;
      if (name === "tower" && event.target.value !== "all") ui.tower = event.target.value;
      renderTowerTabs();
      renderGrid();
      renderRecommendations();
    });
  });

  ["facing", "type", "floor"].forEach((name) => {
    document.getElementById(`launch-${name}-filter`).addEventListener("change", (event) => {
      ui.launchFilters[name] = event.target.value;
      renderLaunch();
    });
  });

  document.getElementById("launch-price-filter").addEventListener("input", (event) => {
    ui.launchFilters.price = Number(event.target.value);
    document.getElementById("launch-price-label").textContent = money(ui.launchFilters.price);
    renderLaunch();
  });

  document.getElementById("budget-filter").addEventListener("input", (event) => {
    ui.filters.budget = Number(event.target.value);
    document.getElementById("budget-label").textContent = money(ui.filters.budget);
    renderGrid();
    renderRecommendations();
  });

  document.getElementById("clear-filters").addEventListener("click", () => {
    ui.filters = { tower: "all", status: "all", facing: "all", type: "all", floor: "all", budget: 100000 };
    renderAll();
  });

  document.getElementById("booking-form").addEventListener("submit", (event) => {
    event.preventDefault();
    finalizeBooking(event.target);
  });

  document.getElementById("cancel-booking-form").addEventListener("click", () => {
    document.getElementById("booking-modal").classList.add("hidden");
  });

  document.getElementById("add-project-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!isAdmin()) return;
    const data = new FormData(event.target);
    const baseId = slug(data.get("projectName") + "-" + data.get("apartmentName"));
    let id = baseId;
    let suffix = 2;
    while (state.projects.some((item) => item.id === id)) id = `${baseId}-${suffix++}`;
    state.projects.push({
      id,
      name: String(data.get("projectName")).trim(),
      apartmentName: String(data.get("apartmentName")).trim(),
      location: String(data.get("location")).trim(),
      phase: String(data.get("phase")).trim().toUpperCase(),
      towers: [],
      units: [],
      events: []
    });
    state.currentProjectId = id;
    event.target.reset();
    resetProjectUi();
    persist("New project added by administrator.");
    showToast("Project created. Add towers and units next.");
    renderAll();
  });

  document.getElementById("add-user-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isAdmin()) return;
    const data = new FormData(event.target);
    const loginId = loginKey(data.get("loginId"));
    if (authState.users.some((user) => loginKey(user.loginId) === loginId)) {
      showToast("This login ID already exists.");
      return;
    }
    const displayName = String(data.get("displayName")).trim();
    authState.users.push({
      id: `user-${Date.now()}`,
      loginId,
      displayName,
      role: String(data.get("role")),
      passwordHash: await hashPassword(String(data.get("password")))
    });
    event.target.reset();
    audit(`User created: ${displayName}`);
    persistAuth(`${displayName} sales login created.`);
    renderAdmin();
    renderLaunch();
    showToast(`Sales login created for ${displayName}.`);
  });

  document.getElementById("template-upload").addEventListener("change", (event) => {
    if (!canManageTemplates()) return;
    const file = event.target.files[0];
    if (!file || file.type !== "image/png") {
      showToast("Only PNG templates are allowed.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      templates().unshift({
        id: `template-${Date.now()}`,
        name: file.name.replace(/\.png$/i, ""),
        type: "PNG Template",
        image: reader.result,
        uploadedBy: agent(),
        uploadedAt: Date.now()
      });
      audit(`PNG template uploaded: ${file.name}`);
      persist("PNG template uploaded.");
      renderAll();
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  });

  document.getElementById("customer-photo-upload").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file || !/^image\/(png|jpeg)$/.test(file.type)) {
      showToast("Customer photo must be JPG, JPEG or PNG.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      document.getElementById("customer-photo-preview").src = reader.result;
      updateCreativePreview();
    };
    reader.readAsDataURL(file);
  });

  ["template-select", "photo-crop", "photo-zoom", "photo-brightness", "photo-contrast", "photo-saturation", "photo-rotate", "photo-x", "photo-y"].forEach((id) => {
    document.getElementById(id).addEventListener("input", updateCreativePreview);
    document.getElementById(id).addEventListener("change", updateCreativePreview);
  });

  document.getElementById("creative-form").addEventListener("input", updateCreativePreview);
  document.getElementById("creative-form").addEventListener("submit", (event) => {
    event.preventDefault();
    saveCreative("Draft");
    showToast("Creative draft saved.");
  });
  document.getElementById("send-approval").addEventListener("click", () => {
    if (!document.getElementById("creative-form").reportValidity()) return;
    const creative = saveCreative("Pending Approval");
    showToast(`${creative.customerName || "Creative"} sent for approval.`);
  });

  ["history-customer-filter", "history-project-filter", "history-sales-filter", "history-date-filter"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderHistory);
  });

  document.getElementById("change-password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isAdmin()) return;
    const data = new FormData(event.target);
    const currentHash = await hashPassword(String(data.get("currentPassword")));
    if (currentHash !== currentUser.passwordHash) {
      showToast("Current admin password is incorrect.");
      return;
    }
    currentUser.passwordHash = await hashPassword(String(data.get("newPassword")));
    authState.initialPasswordActive = false;
    event.target.reset();
    persistAuth("Administrator password updated.");
    showToast("Administrator password updated.");
  });

  document.getElementById("add-tower-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!isAdmin()) return;
    const data = new FormData(event.target);
    const id = String(data.get("towerId")).trim().toUpperCase();
    if (towers().some((tower) => tower.id === id)) return showToast(`Tower ${id} already exists.`);
    project().towers.push({ id, name: String(data.get("towerName")).trim() });
    ui.tower = id;
    event.target.reset();
    persist("Tower added by administrator.");
    showToast(`Tower ${id} added.`);
    renderAll();
  });

  document.getElementById("add-unit-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!isAdmin()) return;
    const data = new FormData(event.target);
    const tower = String(data.get("tower"));
    const floor = Number(data.get("floor"));
    const unitNumber = String(data.get("unitNumber")).trim().toUpperCase();
    const id = `${tower}${floor}${unitNumber}`;
    if (unitById(id)) return showToast(`Unit ${id} already exists.`);
    project().units.push({
      id, tower, floor, position: units().filter((unit) => unit.tower === tower && unit.floor === floor).length + 1,
      type: String(data.get("type")).trim(), area: Number(data.get("area")),
      facing: String(data.get("facing")), priceLakhs: Number(data.get("priceLakhs")),
      featured: data.get("featured") === "on", state: "available",
      heldBy: null, heldUntil: null, heldSession: null, soldBy: null, soldAt: null
    });
    ui.filters.budget = Math.max(ui.filters.budget, Number(data.get("priceLakhs")));
    ui.tower = tower;
    ui.selectedUnit = id;
    event.target.reset();
    persist("Unit added by administrator.");
    showToast(`Unit ${id} added to inventory.`);
    renderAll();
  });

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY && event.newValue) {
      state = JSON.parse(event.newValue);
      if (currentUser) {
        renderAll();
        showToast("Inventory updated from another screen.");
      }
    }
    if (event.key === AUTH_KEY && event.newValue) {
      authState = JSON.parse(event.newValue);
      if (currentUser) {
        const signedInUser = authState.users.find((user) => user.id === currentUser.id);
        if (!signedInUser) {
          currentUser = null;
          sessionStorage.removeItem(SESSION_KEY);
          renderSession();
          return;
        }
        currentUser = signedInUser;
        renderSession();
        renderAll();
      }
    }
  });

  if (channel) channel.addEventListener("message", (event) => {
    if (event.data.type === "auth-refresh") {
      loadAuthState().then((freshAuth) => {
        authState = freshAuth;
        if (!currentUser) return;
        const signedInUser = authState.users.find((user) => user.id === currentUser.id);
        if (!signedInUser) {
          currentUser = null;
          sessionStorage.removeItem(SESSION_KEY);
          renderSession();
          return;
        }
        currentUser = signedInUser;
        renderSession();
        renderAll();
      });
      return;
    }
    state = loadState();
    if (currentUser) {
      renderAll();
      if (event.data.message) showToast(event.data.message);
    }
  });

  setInterval(() => {
    if (currentUser) {
      if (!expireHolds()) renderUnitPanel();
      renderClock();
    }
  }, 1000);

  async function bootstrap() {
    authState = await loadAuthState();
    const sessionUserId = sessionStorage.getItem(SESSION_KEY);
    currentUser = authState.users.find((user) => user.id === sessionUserId) || null;
    renderSession();
    if (currentUser) {
      resetProjectUi();
      expireHolds();
      renderAll();
    }
  }

  bootstrap();
})();
