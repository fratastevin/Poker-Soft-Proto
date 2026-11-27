// File d'attente persistante des requêtes POST en cas d'erreur réseau/script
const STORAGE_QUEUE_KEY = 'poker_pending_requests_v1';
let pendingRequests = [];
let isFlushingQueue = false;

function loadPendingQueue() {
    try {
        const raw = localStorage.getItem(STORAGE_QUEUE_KEY);
        pendingRequests = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(pendingRequests)) pendingRequests = [];
    } catch (e) {
        pendingRequests = [];
    }
    updateQueueIndicatorUI();
}

function persistPendingQueue() {
    try {
        localStorage.setItem(STORAGE_QUEUE_KEY, JSON.stringify(pendingRequests));
    } catch (e) {}
    updateQueueIndicatorUI();
}

function updateQueueIndicatorUI() {
    const el = document.getElementById('queue-indicator');
    if (!el) return;
    if (pendingRequests.length > 0) {
        el.innerText = `⏳ ${pendingRequests.length} synchro(s) en attente`;
    } else {
        el.innerText = '';
    }
}

function enqueuePostRequest(payload, options = {}) {
    const reqId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    pendingRequests.push({
        id: reqId,
        payload: payload,
        notifyErrorOnce: !!options.notifyErrorOnce,
        notified: false,
        attempts: 0,
        nextRetryAt: Date.now()
    });
    persistPendingQueue();
    flushPendingQueue();
}

async function flushPendingQueue() {
    if (!scriptUrl || isFlushingQueue || pendingRequests.length === 0) return;
    isFlushingQueue = true;

    try {
        const now = Date.now();
        const remaining = [];

        for (const item of pendingRequests) {
            if (item.nextRetryAt > now) {
                remaining.push(item);
                continue;
            }
            item.attempts = (item.attempts || 0) + 1;
            try {
                const res = await fetch(scriptUrl, {
                    method: "POST",
                    body: JSON.stringify(item.payload)
                });
                if (!res.ok) throw new Error("HTTP " + res.status);
                const json = await res.json();
                if (json && json.status === "error") {
                    throw new Error(json.message || "Erreur Apps Script");
                }
                if (item.payload && item.payload.action === "eliminer") {
                    console.log("Élimination enregistrée avec succès (file synchro)");
                }
            } catch (err) {
                if (item.notifyErrorOnce && !item.notified) {
                    item.notified = true;
                    alert("⚠️ Erreur de script lors de l'enregistrement : l'action a été mise en file d'attente et sera réessayée automatiquement.");
                }
                // Backoff léger jusqu'à 30s sans bloquer les autres actions
                const delay = Math.min(30000, 3000 * Math.pow(1.5, Math.min(item.attempts, 6)));
                item.nextRetryAt = Date.now() + delay;
                remaining.push(item);
            }
        }

        pendingRequests = remaining;
        persistPendingQueue();
    } finally {
        isFlushingQueue = false;
    }
}

function startRetryQueueLoop() {
    if (retryQueueTimer) clearInterval(retryQueueTimer);
    retryQueueTimer = setInterval(() => {
        if (pendingRequests.length > 0) {
            flushPendingQueue();
        }
    }, 10000);
}
