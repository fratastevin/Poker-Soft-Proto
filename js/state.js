const PALETTE_COULEURS_CLUB = [
    { label: "Rouge", hex: "#ef4444" },
    { label: "Bleu", hex: "#3b82f6" },
    { label: "Jaune", hex: "#eab308" },
    { label: "Vert", hex: "#10b981" },
    { label: "Orange", hex: "#f97316" },
    { label: "Violet", hex: "#a855f7" },
    { label: "Cyan", hex: "#06b6d4" },
    { label: "Rose", hex: "#ec4899" }
];

const MAX_LIVE_HISTORY_ITEMS = 12;

let scriptUrl = "";

let myClientId = localStorage.getItem('poker_client_id');
if (!myClientId) {
    myClientId = 'client_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('poker_client_id', myClientId);
}

let isMaster = sessionStorage.getItem('poker_is_master') === 'true';
let masterToken = sessionStorage.getItem('poker_master_token') || null;

let appData = {
    joueurs: [],
    tournois: [],
    prochainTournoiId: null,
    inscriptions: {},
    maxJoueursParTable: 6,
    startingStack: 20000,
    structures: { MTT: {}, SNG: {} },
    allStates: {},
    tournoisTermines: {},
    classementGeneralMTT: [],
    classementGeneralSNG: []
};

let activeTournoiId = null;
let tablesGenerees = null;
let tablesMeta = {}; // { [tNum]: { name: "Table Rouge", color: "#ef4444" } }
let totalJoueursInitial = 0;
let joueursEliminesHistorique = [];
let liveActionHistory = []; // [{ id, time, type, html }]
let bloquerLastMinute = false;
let alerteIgnoree = false;
let lastLocalInscriptionTime = 0;
let isDraggingClassement = false;
let draggedPlayerName = null;

let niveauActuel = 1;
let dureeNiveauSec = 1200;
let secondesRestantes = 1200;
let chronoEndTime = null;
let chronoIsRunning = false;
let chronoTimer = null;
let globalSyncTimer = null;
let retryQueueTimer = null;

function getActiveTournoi() {
    return (appData.tournois || []).find(t => t.id === activeTournoiId) || null;
}

function getDeadlineClassementLundi23h(dateStr) {
    if (!dateStr || !dateStr.includes('/')) return null;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    let year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;

    const d = new Date(year, month, day, 23, 0, 0, 0);
    const dayOfWeek = d.getDay();
    const daysUntilMonday = (dayOfWeek === 1) ? 0 : (8 - dayOfWeek) % 7;
    d.setDate(d.getDate() + daysUntilMonday);
    return d.getTime();
}

function getFinalTableSize(maxPerTable) {
    if (maxPerTable === 6 || maxPerTable === 7) {
        return maxPerTable + 1;
    }
    return maxPerTable;
}

function getDureeStructureSec(numNiveau) {
    const tournoi = getActiveTournoi();
    const type = (tournoi && tournoi.type === 'SNG') ? 'SNG' : 'MTT';
    const structs = (appData.structures && appData.structures[type]) ? appData.structures[type] : {};
    const structActuelle = structs[numNiveau] || {};
    if (structActuelle.duree && !isNaN(structActuelle.duree) && Number(structActuelle.duree) > 0) {
        return parseFloat(structActuelle.duree);
    }
    if (structActuelle.dureeMinutes && !isNaN(structActuelle.dureeMinutes) && Number(structActuelle.dureeMinutes) > 0) {
        return parseFloat(structActuelle.dureeMinutes) * 60;
    }
    return 1200;
}
