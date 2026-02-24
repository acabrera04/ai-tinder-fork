// app.js
// Plain global JS, no modules.

// -------------------
// Data generator
// -------------------
const TAGS = [
  "Coffee","Hiking","Movies","Live Music","Board Games","Cats","Dogs","Traveler",
  "Foodie","Tech","Art","Runner","Climbing","Books","Yoga","Photography"
];
const FIRST_NAMES = [
  "Alex","Sam","Jordan","Taylor","Casey","Avery","Riley","Morgan","Quinn","Cameron",
  "Jamie","Drew","Parker","Reese","Emerson","Rowan","Shawn","Harper","Skyler","Devon"
];
const CITIES = [
  "Brooklyn","Manhattan","Queens","Jersey City","Hoboken","Astoria",
  "Williamsburg","Bushwick","Harlem","Lower East Side"
];
const JOBS = [
  "Product Designer","Software Engineer","Data Analyst","Barista","Teacher",
  "Photographer","Architect","Chef","Nurse","Marketing Manager","UX Researcher"
];
const BIOS = [
  "Weekend hikes and weekday lattes.",
  "Dog parent. Amateur chef. Karaoke enthusiast.",
  "Trying every taco in the city — for science.",
  "Bookstore browser and movie quote machine.",
  "Gym sometimes, Netflix always.",
  "Looking for the best slice in town.",
  "Will beat you at Mario Kart.",
  "Currently planning the next trip."
];

const UNSPLASH_SEEDS = [
  "1515462277126-2b47b9fa09e6",
  "1520975916090-3105956dac38",
  "1519340241574-2cec6aef0c01",
  "1554151228-14d9def656e4",
  "1548142813-c348350df52b",
  "1517841905240-472988babdf9",
  "1535713875002-d1d0cf377fde",
  "1545996124-0501ebae84d0",
  "1524504388940-b1c1722653e1",
  "1531123897727-8f129e1688ce",
];

function sample(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickTags() { return Array.from(new Set(Array.from({length:4}, ()=>sample(TAGS)))); }
function pickPhotos(count = 3) {
  const seeds = [...UNSPLASH_SEEDS];
  for (let i = seeds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [seeds[i], seeds[j]] = [seeds[j], seeds[i]];
  }
  return seeds.slice(0, count).map(imgFor);
}
function imgFor(seed) {
  return `https://images.unsplash.com/photo-${seed}?auto=format&fit=crop&w=1200&q=80`;
}

function generateProfiles(count = 12) {
  const profiles = [];
  for (let i = 0; i < count; i++) {
    const photos = pickPhotos(3);
    profiles.push({
      id: `p_${i}_${Date.now().toString(36)}`,
      name: sample(FIRST_NAMES),
      age: 18 + Math.floor(Math.random() * 22),
      city: sample(CITIES),
      title: sample(JOBS),
      bio: sample(BIOS),
      tags: pickTags(),
      photos,
      photoIndex: 0,
      img: photos[0],
    });
  }
  return profiles;
}

// -------------------
// UI rendering
// -------------------
const deckEl = document.getElementById("deck");
const shuffleBtn = document.getElementById("shuffleBtn");
const likeBtn = document.getElementById("likeBtn");
const nopeBtn = document.getElementById("nopeBtn");
const superLikeBtn = document.getElementById("superLikeBtn");

let profiles = [];
let isAnimating = false;
let dragState = null;
let lastTapAt = 0;
let actionTimeoutId = null;

const SWIPE_X_THRESHOLD = 110;
const SWIPE_UP_THRESHOLD = -120;

function getTopCard() {
  return deckEl.querySelector(".card");
}

function getTopProfile() {
  return profiles[0] || null;
}

function getPhotoAt(profile) {
  const photos = profile.photos && profile.photos.length > 0 ? profile.photos : [profile.img];
  const idx = ((profile.photoIndex || 0) % photos.length + photos.length) % photos.length;
  return { src: photos[idx], index: idx, total: photos.length };
}

function cycleTopProfilePhoto() {
  const profile = getTopProfile();
  const card = getTopCard();
  if (!profile || !card || !profile.photos || profile.photos.length < 2) return false;

  const img = card.querySelector(".card__media");
  if (!img) return false;

  profile.photoIndex = (profile.photoIndex + 1) % profile.photos.length;
  img.src = profile.photos[profile.photoIndex];
  img.alt = `${profile.name} — profile photo ${profile.photoIndex + 1} of ${profile.photos.length}`;
  return true;
}

function updateControlsState() {
  const disableActions = isAnimating || profiles.length === 0;
  likeBtn.disabled = disableActions;
  nopeBtn.disabled = disableActions;
  superLikeBtn.disabled = disableActions;
}

function actionTransform(action) {
  const xDistance = Math.max(window.innerWidth * 0.85, 420);
  const yDistance = Math.max(window.innerHeight * 0.8, 500);

  if (action === "like") return { x: xDistance, y: -40, rot: 18 };
  if (action === "nope") return { x: -xDistance, y: -40, rot: -18 };
  return { x: 0, y: -yDistance, rot: 0 };
}

function applyAction(action) {
  if (isAnimating || profiles.length === 0) return false;

  const card = getTopCard();
  if (!card) {
    profiles.shift();
    renderDeck();
    return true;
  }

  isAnimating = true;
  updateControlsState();

  const { x, y, rot } = actionTransform(action);
  card.style.transition = "transform 260ms ease, opacity 260ms ease";
  card.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
  card.style.opacity = "0";

  actionTimeoutId = window.setTimeout(() => {
    profiles.shift();
    isAnimating = false;
    actionTimeoutId = null;
    renderDeck();
  }, 260);

  return true;
}

function onCardPointerDown(event) {
  if (isAnimating || event.button !== 0) return;

  const card = getTopCard();
  if (!card || event.currentTarget !== card) return;

  dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    dx: 0,
    dy: 0,
    pointerType: event.pointerType,
    card,
  };

  card.setPointerCapture(event.pointerId);
  card.style.transition = "none";
}

function onCardPointerMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;

  dragState.dx = event.clientX - dragState.startX;
  dragState.dy = event.clientY - dragState.startY;

  const rotate = dragState.dx * 0.08;
  dragState.card.style.transform = `translate(${dragState.dx}px, ${dragState.dy}px) rotate(${rotate}deg)`;
}

function resetDraggedCard(card) {
  card.style.transition = "transform 180ms ease";
  card.style.transform = "translateY(0) scale(1)";
}

function onCardPointerEnd(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;

  const { card, dx, dy } = dragState;
  dragState = null;

  if (card.hasPointerCapture(event.pointerId)) {
    card.releasePointerCapture(event.pointerId);
  }

  if (isAnimating) return;

  if (dy < SWIPE_UP_THRESHOLD && Math.abs(dx) < SWIPE_X_THRESHOLD) {
    applyAction("superlike");
    return;
  }

  if (dx > SWIPE_X_THRESHOLD) {
    applyAction("like");
    return;
  }

  if (dx < -SWIPE_X_THRESHOLD) {
    applyAction("nope");
    return;
  }

  const isTap = Math.abs(dx) < 12 && Math.abs(dy) < 12;
  if (isTap && dragState === null && event.pointerType === "touch") {
    if (event.timeStamp - lastTapAt < 320) {
      lastTapAt = 0;
      cycleTopProfilePhoto();
      resetDraggedCard(card);
      return;
    }
    lastTapAt = event.timeStamp;
  }

  resetDraggedCard(card);
}

function onCardPointerCancel(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;

  const { card } = dragState;
  dragState = null;
  resetDraggedCard(card);
}

function bindTopCardHandlers() {
  const topCard = getTopCard();
  if (!topCard) return;

  topCard.style.touchAction = "none";
  topCard.addEventListener("pointerdown", onCardPointerDown);
  topCard.addEventListener("pointermove", onCardPointerMove);
  topCard.addEventListener("pointerup", onCardPointerEnd);
  topCard.addEventListener("pointercancel", onCardPointerCancel);
  topCard.addEventListener("dblclick", cycleTopProfilePhoto);
}

function renderDeck() {
  deckEl.setAttribute("aria-busy", "true");
  deckEl.innerHTML = "";

  profiles.forEach((p, idx) => {
    const card = document.createElement("article");
    card.className = "card";
    card.style.zIndex = String(profiles.length - idx);

    const img = document.createElement("img");
    const photo = getPhotoAt(p);
    img.className = "card__media";
    img.src = photo.src;
    img.alt = `${p.name} — profile photo ${photo.index + 1} of ${photo.total}`;

    const body = document.createElement("div");
    body.className = "card__body";

    const titleRow = document.createElement("div");
    titleRow.className = "title-row";
    titleRow.innerHTML = `
      <h2 class="card__title">${p.name}</h2>
      <span class="card__age">${p.age}</span>
    `;

    const meta = document.createElement("div");
    meta.className = "card__meta";
    meta.textContent = `${p.title} • ${p.city}`;

    const chips = document.createElement("div");
    chips.className = "card__chips";
    p.tags.forEach((t) => {
      const c = document.createElement("span");
      c.className = "chip";
      c.textContent = t;
      chips.appendChild(c);
    });

    body.appendChild(titleRow);
    body.appendChild(meta);
    body.appendChild(chips);

    card.appendChild(img);
    card.appendChild(body);

    deckEl.appendChild(card);
  });

  deckEl.removeAttribute("aria-busy");
  bindTopCardHandlers();
  updateControlsState();
}

function resetDeck() {
  if (actionTimeoutId !== null) {
    window.clearTimeout(actionTimeoutId);
    actionTimeoutId = null;
  }
  isAnimating = false;
  dragState = null;
  lastTapAt = 0;
  profiles = generateProfiles(12);
  renderDeck();
}

function onKeydown(event) {
  const target = event.target;
  const isTyping =
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable);

  if (isTyping) return;

  if (event.key === "ArrowLeft") {
    if (applyAction("nope")) event.preventDefault();
    return;
  }

  if (event.key === "ArrowRight") {
    if (applyAction("like")) event.preventDefault();
    return;
  }

  if (event.key === "ArrowUp") {
    if (applyAction("superlike")) event.preventDefault();
    return;
  }

  if (event.key.toLowerCase() === "r") {
    resetDeck();
    event.preventDefault();
  }
}

likeBtn.addEventListener("click", () => applyAction("like"));
nopeBtn.addEventListener("click", () => applyAction("nope"));
superLikeBtn.addEventListener("click", () => applyAction("superlike"));
shuffleBtn.addEventListener("click", resetDeck);
document.addEventListener("keydown", onKeydown);

// Boot
resetDeck();
