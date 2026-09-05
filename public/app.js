"use strict";
const $ = (id) => document.getElementById(id);
const BASE = new URL("./", location.href).pathname;
const money = (cents) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
const madridToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const shift = (date, days) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const dateLabel = (date) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
const state = {
  date: madridToday(),
  today: madridToday(),
  denoms: [],
  mode: "denoms",
  entry: null,
  opening: 0,
  openingSource: null,
  revision: null,
  busy: false,
  dirty: false,
  loaded: false,
  baseline: false,
  view: "count",
  loadId: 0,
  history: [],
  hasMore: false,
};
const fields = [
  "actual",
  "cashSales",
  "card",
  "cardBilled",
  "black",
  "preTakeout",
  "expense",
  "added",
  "takeout",
  "declared",
  "tipsOutsidePos",
];
const extraGroups = {
  extraDrops: "Additional cash drop",
  extraExpenses: "Additional till expense",
  extraAdds: "Additional cash added",
  extraTakeouts: "Additional closing withdrawal",
};
function hide(id, hidden = true) {
  $(id).classList.toggle("hidden", hidden);
}
function node(tag, className = "", text = "") {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}
function notify(text, label, action) {
  $("noticeText").textContent = text;
  hide("notice", false);
  hide("noticeAction", !label);
  $("noticeAction").textContent = label || "";
  $("noticeAction").onclick = action || null;
}
function showError(error) {
  $("errorText").textContent = error.message || String(error);
  hide("error", false);
  $("connection").textContent = navigator.onLine
    ? "Needs attention"
    : "Offline";
}
async function api(path, method = "GET", body, revision = state.revision) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && revision !== null)
    headers["If-Match"] = String(revision);
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(BASE + "api/" + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(data.error || "Request failed."), {
        status: response.status,
        field: data.field,
      });
    return data;
  } catch (error) {
    if (error instanceof TypeError || error.name === "AbortError")
      throw new Error(
        "Could not reach Zeus. Your inputs are kept on this device. Reconnect and retry.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function setBusy(value) {
  state.busy = value;
  document
    .querySelectorAll(
      "#countView input,#countView textarea,#countView button,#historyView button",
    )
    .forEach((el) => (el.disabled = value));
  $("nextDay").disabled = value || state.date >= state.today;
  $("checkBtn").disabled = value || !state.loaded;
}
function parseMoney(value) {
  const raw = String(value ?? "")
    .trim()
    .replace(/\s/g, "");
  if (!raw) return null;
  const match = raw.match(/^(\d{1,9})(?:[.,](\d{1,2}))?$/);
  if (!match) return NaN;
  return Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
}
function readAmount(el, issues) {
  const cents = parseMoney(el.value);
  if (Number.isNaN(cents))
    issues.push({
      el,
      message:
        "Use a positive amount or zero, with at most two decimal places.",
    });
  return cents || 0;
}
function addExtra(group, value = "") {
  const row = node("div", "extra-row"),
    input = node("input");
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.placeholder = "0,00";
  input.value = value;
  input.setAttribute("aria-label", extraGroups[group]);
  const remove = node("button", "icon-button", "×");
  remove.type = "button";
  remove.setAttribute(
    "aria-label",
    "Remove " + extraGroups[group].toLowerCase(),
  );
  remove.onclick = () => {
    row.remove();
    markDirty();
  };
  row.append(input, remove);
  $(group).append(row);
  return input;
}
function addTip(tip = {}) {
  const row = node("div", "tip-row");
  row.tip = { ...tip };
  const label = node("label", "", "Cash tip paid out (€)"),
    wrap = node("div", "extra-row"),
    input = node("input");
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.placeholder = "0,00";
  input.value = tip.cashGiven || "";
  input.className = "tip-amount";
  input.setAttribute("aria-label", "Cash tip paid out");
  const remove = node("button", "icon-button", "×");
  remove.type = "button";
  remove.setAttribute("aria-label", "Remove card tip");
  remove.onclick = () => {
    row.remove();
    markDirty();
  };
  wrap.append(input, remove);
  label.append(wrap);
  row.append(label);
  if (tip.reference || tip.time || tip.cardCharged)
    row.append(
      node(
        "p",
        "hint",
        [
          tip.reference,
          tip.time,
          tip.cardCharged
            ? "Original card charge " + money(parseMoney(tip.cardCharged))
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    );
  $("cardCashRows").append(row);
  return input;
}
function buildDenoms() {
  for (const d of state.denoms) {
    const row = node("div", "denom-tile"),
      label = node(
        "label",
        "denom-face",
        d.valueCents < 100 ? d.valueCents + "c" : d.label,
      );
    label.htmlFor = "denom-" + d.id;
    const input = node("input");
    input.id = label.htmlFor;
    input.dataset.denom = d.id;
    input.inputMode = "numeric";
    input.placeholder = "0";
    input.autocomplete = "off";
    input.setAttribute(
      "aria-label",
      "Number of " + d.label + (d.valueCents >= 500 ? " notes" : " coins"),
    );
    const subtotal = node("span", "denom-subtotal", "€0.00");
    subtotal.id = "subtotal-" + d.id;
    row.append(label, input, subtotal);
    $(
      d.valueCents >= 10000
        ? "largeNotesList"
        : d.valueCents >= 500
          ? "notes"
          : "coins",
    ).append(row);
  }
}
function changeMode(mode, dirty = true) {
  if (mode === "total" && state.mode === "denoms" && !$("actual").value) {
    const count = readForm().actual;
    if (count !== null) $("actual").value = (count / 100).toFixed(2);
  }
  state.mode = mode;
  hide("denomPanel", mode !== "denoms");
  hide("totalPanel", mode !== "total");
  $("denomMode").setAttribute("aria-pressed", String(mode === "denoms"));
  $("totalMode").setAttribute("aria-pressed", String(mode === "total"));
  if (dirty) markDirty();
  else preview();
}
function readForm() {
  const issues = [],
    counts = {};
  let total = 0,
    entered = false;
  for (const d of state.denoms) {
    const el = $("denom-" + d.id),
      raw = el.value.trim();
    if (raw) entered = true;
    const valid = /^\d+$/.test(raw) && Number(raw) <= 1000000;
    if (raw && !valid && state.mode === "denoms")
      issues.push({
        el,
        message: "Enter a whole number of notes or coins, from 0 to 1,000,000.",
      });
    counts[d.id] = valid ? Number(raw) : 0;
    total += counts[d.id] * d.valueCents;
  }
  let actual =
    state.mode === "denoms"
      ? entered
        ? total
        : null
      : parseMoney($("actual").value);
  if (Number.isNaN(actual)) {
    issues.push({
      el: $("actual"),
      message: "Enter a cash total with at most two decimal places.",
    });
    actual = null;
  }
  const sum = (id, group) =>
    [$(id), ...document.querySelectorAll("#" + group + " input")].reduce(
      (n, el) => n + readAmount(el, issues),
      0,
    );
  const cashSales = readAmount($("cashSales"), issues),
    black = readAmount($("black"), issues),
    expense = sum("expense", "extraExpenses"),
    added = sum("added", "extraAdds"),
    drop = sum("preTakeout", "extraDrops"),
    takeout = sum("takeout", "extraTakeouts");
  const pos = parseMoney($("card").value),
    billed = parseMoney($("cardBilled").value);
  for (const [id, value] of [
    ["card", pos],
    ["cardBilled", billed],
  ])
    if (Number.isNaN(value))
      issues.push({
        el: $(id),
        message: "Enter a valid card total with at most two decimal places.",
      });
  const tips = [];
  for (const row of document.querySelectorAll(".tip-row")) {
    const input = row.querySelector("input"),
      raw = input.value.trim();
    if (!raw) continue;
    const cents = parseMoney(raw);
    if (!Number.isFinite(cents) || cents <= 0)
      issues.push({
        el: input,
        message: "A card tip must be greater than zero.",
      });
    else tips.push({ ...row.tip, cashGiven: (cents / 100).toFixed(2) });
  }
  const tipCents = tips.reduce((sum, t) => sum + parseMoney(t.cashGiven), 0),
    outside = $("tipsOutsidePos").checked;
  const expected =
      state.opening + cashSales + black + added - expense - drop - tipCents,
    remaining = actual === null ? null : actual - takeout;
  if (remaining !== null && remaining < 0)
    issues.push({
      el: $("takeout"),
      message: "You cannot take out more cash than you counted.",
    });
  const cardVariance =
    Number.isFinite(pos) && Number.isFinite(billed)
      ? billed - pos - (outside ? tipCents : 0)
      : null;
  return {
    actual,
    counts,
    total,
    issues,
    cashSales,
    black,
    expense,
    added,
    drop,
    takeout,
    tips,
    tipCents,
    pos,
    billed,
    outside,
    expected,
    remaining,
    cardVariance,
    variance: actual === null ? null : actual - expected,
  };
}
function payloadFrom(form) {
  return {
    actual: form.actual === null ? undefined : (form.actual / 100).toFixed(2),
    denominations: state.mode === "denoms" ? form.counts : null,
    cashSales: (form.cashSales / 100).toFixed(2),
    black: (form.black / 100).toFixed(2),
    expense: (form.expense / 100).toFixed(2),
    cashAdded: (form.added / 100).toFixed(2),
    preTakeout: (form.drop / 100).toFixed(2),
    takeout: (form.takeout / 100).toFixed(2),
    posCardSales: form.pos === null ? "" : (form.pos / 100).toFixed(2),
    cardBilled: form.billed === null ? null : (form.billed / 100).toFixed(2),
    cardCashTransactions: form.tips,
    tipsOutsidePos: form.outside,
    declared: $("declared").value,
  };
}
function validate(form) {
  document.querySelectorAll(".field-error").forEach((el) => el.remove());
  document
    .querySelectorAll("[aria-invalid]")
    .forEach((el) => el.removeAttribute("aria-invalid"));
  if (form.actual === null)
    form.issues.unshift({
      el: state.mode === "denoms" ? $("denom-50") : $("actual"),
      message:
        "Enter a count first. Use “Drawer is empty” to record zero cash.",
    });
  if ((form.pos === null) !== (form.billed === null))
    form.issues.push({
      el: form.pos === null ? $("card") : $("cardBilled"),
      message:
        "Enter both card totals, or leave both blank to skip the card check.",
    });
  if (!form.issues.length) return true;
  for (const [i, issue] of form.issues.entries()) {
    issue.el.setAttribute("aria-invalid", "true");
    const label = node("p", "field-error", issue.message);
    label.id = "field-error-" + i;
    issue.el.setAttribute("aria-describedby", label.id);
    issue.el.insertAdjacentElement("afterend", label);
  }
  const first = form.issues[0];
  first.el.closest("details")?.setAttribute("open", "");
  first.el.focus();
  showError(new Error(first.message));
  return false;
}
function preview() {
  const f = readForm();
  for (const d of state.denoms)
    $("subtotal-" + d.id).textContent = money(f.counts[d.id] * d.valueCents);
  const actual = Number.isFinite(f.actual) ? money(f.actual) : "—";
  $("denomTotal").textContent = actual;
  $("stickyTotal").textContent = actual;
  $("actualOut").textContent = actual;
  $("remaining").textContent = f.remaining === null ? "—" : money(f.remaining);
  $("expectedNow").textContent = state.baseline
    ? "Not established"
    : money(f.expected);
  const source = state.openingSource;
  if (source?.provisional) {
    const gap = source.gapDays
      ? ` · ${source.gapDays} uncounted day${source.gapDays === 1 ? "" : "s"} in between`
      : "";
    $("openingWarning").textContent =
      `Opening ${money(state.opening)} carried from ${dateLabel(source.date)}${source.confirmed ? "" : " · saved but not confirmed"}${gap}.`;
    $("openingWarning").className = "check-line over";
  } else {
    $("openingWarning").className = "check-line neutral hidden";
    $("openingWarning").textContent = "";
  }
  $("varianceOut").textContent =
    f.variance === null || state.baseline ? "—" : money(f.variance);
  let status = "neutral",
    title = "Ready when you are",
    detail = "Enter your count to see the difference.",
    icon = "…";
  if (f.issues.length) {
    title = "Check your inputs";
    detail = f.issues[0].message;
    icon = "!";
  } else if (state.baseline) {
    title = "Starting balance";
    detail =
      "This count establishes a baseline. It cannot prove whether cash is missing.";
    icon = "↗";
  } else if (f.variance !== null) {
    status = f.variance === 0 ? "balanced" : f.variance < 0 ? "short" : "over";
    title =
      f.variance === 0
        ? "Cash matches"
        : money(Math.abs(f.variance)) + (f.variance < 0 ? " short" : " extra");
    detail =
      f.variance === 0
        ? "The cash counted agrees with the recorded movements."
        : f.variance < 0
          ? "Less cash than expected. Recount and check the movements."
          : "More cash than expected. Check for an unrecorded receipt.";
    icon = f.variance === 0 ? "✓" : f.variance < 0 ? "−" : "+";
  }
  $("liveCheck").className = "result " + status;
  $("resultTitle").textContent = title;
  $("resultDetail").textContent = detail;
  $("resultIcon").textContent = icon;
  let cardText = "Card not checked · enter both totals to compare.",
    cardStatus = "neutral";
  if (f.cardVariance !== null) {
    cardStatus = f.cardVariance === 0 ? "balanced" : "short";
    cardText =
      f.cardVariance === 0
        ? "✓ Card matches" + (f.outside ? " · cash tips accounted for." : ".")
        : "Card difference: " +
          money(f.cardVariance) +
          " · terminal minus " +
          (f.outside ? "POS and tips." : "POS.");
    if (f.variance && Math.sign(f.variance) !== Math.sign(f.cardVariance)) {
      const offset = Math.min(Math.abs(f.variance), Math.abs(f.cardVariance));
      const combined = f.variance + f.cardVariance;
      const direction =
        f.variance < 0
          ? "card sale marked as cash in POS"
          : "cash sale marked as card in POS";
      cardStatus = combined === 0 ? "balanced" : "over";
      cardText +=
        combined === 0
          ? ` · ✓ Combined takings match. Likely ${money(offset)} ${direction}.`
          : ` · Likely about ${money(offset)} ${direction}. After offsetting cash/card, ${money(Math.abs(combined))} still differs.`;
    }
  }
  $("paymentCheck").className = "check-line " + cardStatus;
  $("paymentCheck").textContent = cardText;

  // Make the end-of-day truth explicit: cash and card can be individually
  // wrong because a sale was classified under the wrong payment method.
  // Their signed variances cancel when total takings are actually right.
  if (f.cardVariance === null || f.variance === null || state.baseline) {
    hide("combinedCheck");
  } else {
    hide("combinedCheck", false);
    const combined = f.variance + f.cardVariance;
    const opposite =
      f.variance !== 0 &&
      f.cardVariance !== 0 &&
      Math.sign(f.variance) !== Math.sign(f.cardVariance);
    const offset = opposite
      ? Math.min(Math.abs(f.variance), Math.abs(f.cardVariance))
      : 0;
    $("combinedCash").textContent = money(f.variance);
    $("combinedCard").textContent = money(f.cardVariance);
    $("combinedNet").textContent = money(combined);
    const box = $("combinedCheck");
    box.className =
      "combined-check " +
      (combined === 0
        ? "combined-ok"
        : opposite
          ? "combined-mix"
          : "combined-bad");
    if (combined === 0) {
      $("combinedTitle").textContent = "✓ Total takings reconcile";
      $("combinedDetail").textContent = offset
        ? `Cash and card cancel exactly. Likely ${money(offset)} was marked under the wrong payment method in the POS.`
        : "Cash and card are both correct in total.";
    } else if (opposite) {
      $("combinedTitle").textContent = "Likely payment-method mix-up";
      $("combinedDetail").textContent =
        `${money(offset)} of the cash/card differences cancel each other. ` +
        `${money(Math.abs(combined))} remains unexplained overall.`;
    } else {
      $("combinedTitle").textContent = "Total takings still do not reconcile";
      $("combinedDetail").textContent =
        `Cash and card differences point the same way. Net unexplained difference: ${money(Math.abs(combined))}.`;
    }
  }
  $("movementTotal").textContent = [
    f.black,
    f.added,
    f.expense,
    f.drop,
    f.tipCents,
  ].some(Boolean)
    ? "Net " + money(f.black + f.added - f.expense - f.drop - f.tipCents)
    : "Only when needed";
  const lines = [
    ["Opening cash", state.opening],
    ["Cash sales", f.cashSales],
    ["Other cash income", f.black],
    ["Cash added", f.added],
    ["Till expenses", -f.expense],
    ["Before-count cash drops", -f.drop],
    ["Card tips paid in cash", -f.tipCents],
  ];
  $("cashMath").replaceChildren(
    ...lines
      .filter(([, v], i) => v || i === 0)
      .map(([label, value]) => {
        const row = node("div");
        row.append(node("dt", "", label), node("dd", "", money(value)));
        return row;
      }),
  );
  $("saveStatus").textContent = state.dirty
    ? state.draftAvailable === false
      ? "Unsaved · keep this tab open"
      : "Draft on this device"
    : state.entry
      ? state.entry.confirmed
        ? "Confirmed · saved on Zeus"
        : "Saved on Zeus · not confirmed"
      : "Nothing saved yet";
  $("entryStatus").textContent = state.dirty
    ? "Unsaved"
    : state.entry
      ? state.entry.confirmed
        ? "Confirmed"
        : "Draft saved"
      : "New count";
  $("entryStatus").className =
    "pill" + (state.entry?.confirmed ? " confirmed" : "");
  $("checkBtn").textContent = state.busy
    ? "Saving…"
    : state.entry && !state.dirty
      ? state.entry.confirmed
        ? "Saved ✓"
        : "Review & confirm"
      : state.entry
        ? "Save changes →"
        : "Save & check →";
  $("checkBtn").disabled =
    state.busy || !state.loaded || !!(state.entry?.confirmed && !state.dirty);
  hide("confirmBtn", !state.entry || state.dirty || state.entry.confirmed);
  hide("savedResult", !state.entry || state.dirty);
  if (state.entry)
    $("savedResult").textContent = state.entry.confirmed
      ? "Confirmed. " +
        money(parseMoney(state.entry.remaining)) +
        " was left for the next opening."
      : "Count saved. Review it, then confirm the amount left in the drawer.";
}
function capture() {
  const values = {};
  for (const id of fields)
    values[id] = $(id).type === "checkbox" ? $(id).checked : $(id).value;
  const denoms = {};
  for (const d of state.denoms) denoms[d.id] = $("denom-" + d.id).value;
  const extras = {};
  for (const id of Object.keys(extraGroups))
    extras[id] = [...$(id).querySelectorAll("input")].map((el) => el.value);
  const tips = [...document.querySelectorAll(".tip-row")].map((row) => ({
    ...row.tip,
    cashGiven: row.querySelector("input").value,
  }));
  return {
    date: state.date,
    mode: state.mode,
    values,
    denoms,
    extras,
    tips,
    revision: state.revision,
    updatedAt: state.entry?.updatedAt || null,
    savedAt: Date.now(),
  };
}
const draftKey = (date) => "till-check:v2:" + BASE + ":" + date;
function writeDraft() {
  if (!state.dirty || !state.loaded) return;
  try {
    localStorage.setItem(draftKey(state.date), JSON.stringify(capture()));
    state.draftAvailable = true;
  } catch {
    state.draftAvailable = false;
    $("saveStatus").textContent = "Unsaved · keep this tab open";
    notify(
      "Draft recovery is unavailable in this browser. Keep this tab open until the count is saved.",
    );
  }
}
function readDraft(date) {
  try {
    return JSON.parse(localStorage.getItem(draftKey(date)) || "null");
  } catch {
    return null;
  }
}
function removeDraft(date) {
  try {
    localStorage.removeItem(draftKey(date));
  } catch {}
}
function markDirty() {
  if (!state.loaded || state.busy) return;
  state.dirty = true;
  hide("error");
  preview();
  writeDraft();
}
function hydrate(draft) {
  for (const id of fields) {
    if ($(id).type === "checkbox") $(id).checked = !!draft.values?.[id];
    else $(id).value = draft.values?.[id] ?? "";
  }
  for (const d of state.denoms)
    $("denom-" + d.id).value = draft.denoms?.[d.id] ?? "";
  for (const id of Object.keys(extraGroups)) {
    $(id).replaceChildren();
    for (const value of draft.extras?.[id] || []) addExtra(id, value);
  }
  $("cardCashRows").replaceChildren();
  for (const tip of draft.tips || []) addTip(tip);
  state.mode = draft.mode || "denoms";
  changeMode(state.mode, false);
  $("largeNotes").open = state.denoms.some(
    (d) => d.valueCents >= 10000 && Number(draft.denoms?.[d.id]) > 0,
  );
  $("adjustments").open =
    ["black", "preTakeout", "expense", "added"].some(
      (id) => Number(draft.values?.[id]) > 0,
    ) || !!draft.tips?.length;
}
function hydrateEntry(entry) {
  const values = {};
  if (entry)
    for (const [id, key] of Object.entries({
      actual: "actual",
      cashSales: "cashSales",
      card: "posCardSales",
      cardBilled: "cardBilled",
      black: "black",
      preTakeout: "preTakeout",
      expense: "expense",
      added: "cashAdded",
      takeout: "takeout",
      declared: "declared",
      tipsOutsidePos: "tipsOutsidePos",
    }))
      values[id] = entry[key] ?? "";
  if (entry?.cardBilled === null) values.card = "";
  hydrate({
    values,
    denoms: entry?.denominations || {},
    mode: entry && !entry.denominations ? "total" : "denoms",
    tips: entry?.cardCashTransactions || [],
  });
}
async function loadDay(date, push = true) {
  if (state.busy) return;
  writeDraft();
  const id = ++state.loadId;
  state.loaded = false;
  setBusy(true);
  hide("error");
  $("connection").textContent = "Loading…";
  try {
    const data = await api("state?date=" + encodeURIComponent(date));
    if (id !== state.loadId) return;
    Object.assign(state, {
      date,
      today: data.today,
      entry: data.entry,
      opening: parseMoney(data.selectedOpening) || 0,
      openingSource: data.openingSource || null,
      revision: data.revision,
      dirty: false,
      loaded: true,
      baseline: !!data.entry?.baselineOnly || (!data.hasOpening && !data.entry),
    });
    $("entryDate").value = date;
    $("entryDate").max = state.today;
    $("dayRelative").textContent =
      date === state.today
        ? "Today"
        : date === shift(state.today, -1)
          ? "Yesterday"
          : "Selected day";
    $("dayCalendar").textContent = dateLabel(date);
    hydrateEntry(data.entry);
    hide("setup", data.hasOpening || !!data.entry);
    hide("entryCard", !data.hasOpening && !data.entry);
    hide(
      "saveBar",
      (!data.hasOpening && !data.entry) || state.view !== "count",
    );
    hide("draftBanner", !readDraft(date));
    if (push) {
      const url = new URL(location.href);
      url.searchParams.set("date", date);
      history.replaceState(null, "", url);
    }
    $("connection").textContent = "Connected";
    preview();
  } catch (error) {
    showError(error);
    $("entryDate").value = state.date;
  } finally {
    if (id === state.loadId) {
      setBusy(false);
      if (state.loaded) preview();
    }
  }
}
function setView(view) {
  state.view = view;
  hide("countView", view !== "count");
  hide("historyView", view !== "history");
  hide(
    "saveBar",
    view !== "count" || $("entryCard").classList.contains("hidden"),
  );
  for (const [id, v] of [
    ["countTab", "count"],
    ["historyTab", "history"],
  ]) {
    $(id).classList.toggle("active", v === view);
    if (v === view) $(id).setAttribute("aria-current", "page");
    else $(id).removeAttribute("aria-current");
  }
  if (view === "history") loadHistory().catch(showError);
}
async function ask(
  title,
  description,
  accept = "Confirm",
  content = null,
  danger = false,
) {
  const dialog = $("actionDialog");
  $("dialogTitle").textContent = title;
  $("dialogDescription").textContent = description;
  $("dialogAccept").textContent = accept;
  $("dialogAccept").className = danger ? "primary danger" : "primary";
  $("dialogContent").replaceChildren();
  if (content) $("dialogContent").append(content);
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) =>
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "accept"),
      { once: true },
    ),
  );
}
async function save() {
  if (state.busy || !state.loaded) return;
  const f = readForm();
  if (!validate(f)) return;
  if (
    state.entry?.confirmed &&
    !(await ask(
      "Correct a confirmed count?",
      "This updates the saved record and any affected opening balances. The original values remain in the audit history.",
      "Save correction",
    ))
  )
    return;
  setBusy(true);
  hide("error");
  preview();
  try {
    const entry = await api(
      state.entry ? "entry/" + state.date : "entry",
      state.entry ? "PATCH" : "POST",
      { ...payloadFrom(f), date: state.date },
    );
    state.entry = entry;
    state.revision = entry.revision;
    state.opening = parseMoney(entry.opening);
    state.baseline = entry.baselineOnly;
    state.dirty = false;
    removeDraft(state.date);
    hide("draftBanner");
    notify(
      entry.confirmed
        ? "Correction saved. The carry-forward balance has been updated."
        : "Count saved on Zeus. Review the result and confirm the day.",
    );
    $("connection").textContent = "Connected";
  } catch (error) {
    showError(error);
    writeDraft();
  } finally {
    setBusy(false);
    preview();
  }
}
async function confirmDay() {
  if (state.busy || state.dirty || !state.entry) return;
  const entry = state.entry,
    detail = node("div");
  const counted = money(parseMoney(entry.actual));
  const withdrawn = money(parseMoney(entry.takeout));
  const left = money(parseMoney(entry.remaining));
  detail.append(
    node(
      "p",
      "",
      `${counted} counted − ${withdrawn} withdrawn = ${left} left in the drawer.`,
    ),
  );
  if (entry.overallMatches !== true)
    detail.append(
      node(
        "p",
        "dialog-warning",
        "This is not a verified full match. Card totals may be unchecked or a difference may remain. Confirmation preserves the discrepancy.",
      ),
    );
  const accepted = await ask(
    "Confirm " + dateLabel(state.date) + "?",
    "Check the cash remaining before accepting this count as the next opening.",
    "Confirm day",
    detail,
  );
  if (!accepted) return;
  setBusy(true);
  try {
    const result = await api("confirm", "POST", { date: state.date });
    state.revision = result.revision;
    state.entry = { ...entry, confirmed: true };
    notify("Day confirmed. " + left + " remains in the drawer.");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
    preview();
  }
}
async function restoreDraft() {
  const draft = readDraft(state.date);
  if (!draft) return;
  if (draft.revision !== state.revision) {
    const accepted = await ask(
      "Review an older local draft?",
      "The ledger changed after this draft was written. Restoring replaces the form, not the saved record. Check the amounts before saving.",
      "Restore for review",
    );
    if (!accepted) return;
  }
  hydrate(draft);
  state.dirty = true;
  hide("draftBanner");
  preview();
  writeDraft();
  notify("Draft restored to the form. Review it, then save to Zeus.");
}
async function loadHistory(more = false) {
  const before = more && state.history.length ? state.history.at(-1).date : "";
  const data = await api(
    "history?limit=30" + (before ? "&before=" + before : ""),
  );
  state.history = more ? [...state.history, ...data.entries] : data.entries;
  state.hasMore = data.hasMore;
  hide("loadMore", !data.hasMore);
  renderHistory();
}
function renderHistory() {
  const entries = state.history;
  $("historyStats").replaceChildren(
    node("span", "", entries.length + " days loaded"),
    node(
      "span",
      "",
      entries.filter((e) => !e.confirmed).length + " awaiting confirmation",
    ),
    node(
      "span",
      "",
      entries.filter((e) => e.status !== "balanced" || e.cardMatches === false)
        .length + " with differences",
    ),
  );
  $("ledger").replaceChildren();
  if (!entries.length) {
    const empty = node("div", "empty-state");
    empty.append(
      node("h2", "", "Your first count starts the story."),
      node(
        "p",
        "",
        "Saved days will appear here, with their differences and change history.",
      ),
    );
    $("ledger").append(empty);
    return;
  }
  for (const entry of entries) {
    const row = node("article", "history-row");
    row.dataset.date = entry.date;
    const title = node("div");
    title.append(node("h2", "", dateLabel(entry.date)));
    title.append(
      node(
        "p",
        "",
        (entry.confirmed ? "Confirmed" : "Awaiting confirmation") +
          " · " +
          money(parseMoney(entry.remaining)) +
          " left in drawer",
      ),
    );
    const amount = node("div", "amount", money(parseMoney(entry.actual)));
    row.append(title, amount);
    const badges = node("div", "status-badges");
    badges.append(
      node(
        "span",
        "status-badge " + entry.status,
        entry.baselineOnly
          ? "Starting baseline"
          : entry.status === "balanced"
            ? "Cash matches"
            : money(Math.abs(parseMoney(entry.variance))) + " " + entry.status,
      ),
    );
    badges.append(
      node(
        "span",
        "status-badge " +
          (entry.cardMatches === null
            ? "neutral"
            : entry.cardMatches
              ? ""
              : "short"),
        entry.cardMatches === null
          ? "Card not checked"
          : entry.cardMatches
            ? "Card matches"
            : "Card difference " + money(parseMoney(entry.cardVariance)),
      ),
    );
    row.append(badges);
    if (entry.declared) row.append(node("p", "history-note", entry.declared));
    const actions = node("div", "row-actions");
    const open = node("button", "secondary", "Open count");
    open.onclick = () => {
      setView("count");
      loadDay(entry.date).catch(showError);
      window.scrollTo({ top: 0 });
    };
    const move = node("button", "text-button", "Change date");
    move.onclick = () => moveEntry(entry).catch(showError);
    const remove = node("button", "text-button", "Delete");
    remove.setAttribute("aria-label", "Delete " + entry.date);
    remove.onclick = () => deleteEntry(entry).catch(showError);
    actions.append(open, move, remove);
    row.append(actions);
    $("ledger").append(row);
  }
}
async function deleteEntry(entry) {
  if (state.busy) return;
  const before = await api("state?date=" + entry.date);
  if (
    !(await ask(
      "Delete " + dateLabel(entry.date) + "?",
      "The entry will leave the ledger, and affected opening balances will be recalculated. Its original values remain in the audit history. You can undo until another change is made.",
      "Delete entry",
      null,
      true,
    ))
  )
    return;
  setBusy(true);
  try {
    const result = await api(
      "entry/" + entry.date,
      "DELETE",
      undefined,
      before.revision,
    );
    notify("Entry deleted.", "Undo", () => undoDelete(result).catch(showError));
    await loadHistory();
    if (state.date === entry.date) state.loaded = false;
  } finally {
    setBusy(false);
  }
}
async function undoDelete(result) {
  if (state.busy) return;
  setBusy(true);
  try {
    await api("undo", "POST", { auditId: result.auditId }, result.revision);
    notify("Entry restored, including its original values.");
    await loadHistory();
    state.loaded = false;
  } finally {
    setBusy(false);
  }
}
async function moveEntry(entry) {
  if (state.busy) return;
  const before = await api("state?date=" + entry.date),
    content = node("label", "", "Correct date");
  const input = node("input");
  input.type = "date";
  input.value = entry.date;
  input.max = state.today;
  input.setAttribute("aria-label", "Correct date");
  content.append(input);
  if (
    !(await ask(
      "Change the date of this count?",
      "This moves the saved record without creating a copy. An occupied date cannot be overwritten. Opening balances may be recalculated.",
      "Move saved count",
      content,
    ))
  )
    return;
  if (!input.value || input.value === entry.date) return;
  setBusy(true);
  try {
    await api(
      "entry/" + entry.date + "/move",
      "POST",
      { date: input.value },
      before.revision,
    );
    notify("Count moved to " + dateLabel(input.value) + ".");
    await loadHistory();
    state.loaded = false;
  } finally {
    setBusy(false);
  }
}
$("countTab").onclick = () => {
  setView("count");
  if (!state.loaded) loadDay(state.date).catch(showError);
};
$("historyTab").onclick = () => setView("history");
$("denomMode").onclick = () => changeMode("denoms");
$("totalMode").onclick = () => changeMode("total");
$("emptyDrawer").onclick = () => {
  $("actual").value = "0";
  changeMode("total");
};
$("previousDay").onclick = () =>
  loadDay(shift(state.date, -1)).catch(showError);
$("nextDay").onclick = () => {
  const date = shift(state.date, 1);
  if (date <= state.today) loadDay(date).catch(showError);
};
$("entryDate").onchange = () => {
  if ($("entryDate").value) loadDay($("entryDate").value).catch(showError);
};
$("checkBtn").onclick = () => {
  (state.entry && !state.dirty && !state.entry.confirmed
    ? confirmDay()
    : save()
  ).catch(showError);
};
$("confirmBtn").onclick = () => confirmDay().catch(showError);
$("restoreDraft").onclick = () => restoreDraft().catch(showError);
$("discardDraft").onclick = () => {
  removeDraft(state.date);
  hide("draftBanner");
};
$("dismissNotice").onclick = () => hide("notice");
$("retryLoad").onclick = () => loadDay(state.date).catch(showError);
$("loadMore").onclick = async () => {
  if (state.busy) return;
  setBusy(true);
  try {
    await loadHistory(true);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
};
for (const [button, group] of [
  ["addDrop", "extraDrops"],
  ["addExpense", "extraExpenses"],
  ["addAdded", "extraAdds"],
  ["addTakeout", "extraTakeouts"],
]) {
  $(button).onclick = () => {
    addExtra(group).focus();
    markDirty();
  };
}
$("addCardCash").onclick = () => {
  addTip().focus();
  markDirty();
};
$("entryCard").addEventListener("input", (event) => {
  if (event.target.matches("input,textarea")) markDirty();
});
$("entryCard").addEventListener("focusin", (event) => {
  if (
    event.target instanceof HTMLInputElement &&
    ["0", "0.00"].includes(event.target.value)
  )
    event.target.select();
});
$("unknownOpening").onclick = () => {
  hide("setup");
  hide("entryCard", false);
  hide("saveBar", false);
  state.baseline = true;
  preview();
};
$("setupBtn").onclick = async () => {
  if (state.busy) return;
  const value = parseMoney($("setupAmount").value);
  if (!Number.isFinite(value)) {
    showError(
      new Error(
        "Enter a starting balance, including 0 when the drawer started empty.",
      ),
    );
    $("setupAmount").focus();
    return;
  }
  setBusy(true);
  try {
    await api("opening", "POST", {
      opening: (value / 100).toFixed(2),
      date: state.date,
    });
    setBusy(false);
    await loadDay(state.date);
    notify("Opening balance set. You can count the drawer now.");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
};
$("auditDetails").ontoggle = async () => {
  if (!$("auditDetails").open) return;
  try {
    const data = await api("audit");
    $("auditList").replaceChildren(
      ...data.events.map((e) =>
        node(
          "p",
          "",
          new Intl.DateTimeFormat("en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Europe/Madrid",
          }).format(new Date(e.createdAt)) +
            " · " +
            e.action +
            (e.date ? " · " + dateLabel(e.date) : "") +
            " · revision " +
            e.revision,
        ),
      ),
    );
    if (!data.events.length)
      $("auditList").append(
        node(
          "p",
          "",
          "Changes made from this version onward will appear here.",
        ),
      );
  } catch (error) {
    showError(error);
  }
};
window.addEventListener("offline", () => {
  $("connection").textContent = "Offline";
  notify(
    "You are offline. Your draft stays on this device; saving needs a connection to Zeus.",
  );
});
window.addEventListener("online", () => {
  $("connection").textContent = "Connection restored";
});
window.addEventListener("pagehide", writeDraft);
window.addEventListener("beforeunload", (event) => {
  if (state.dirty) {
    writeDraft();
    event.preventDefault();
    event.returnValue = "";
  }
});
async function init() {
  $("checkBtn").disabled = true;
  const data = await api("denominations");
  state.denoms = data.denominations;
  for (const id of ["notes", "largeNotesList", "coins"])
    $(id).replaceChildren();
  buildDenoms();
  const date = new URL(location.href).searchParams.get("date") || state.today;
  await loadDay(/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : state.today);
  $("exportLink").href = BASE + "api/export.csv";
}
$("retryLoad").onclick = () => {
  (state.denoms.length ? loadDay(state.date) : init()).catch(showError);
};
init().catch(showError);
