window.onload = function() {
    loadPendingQueue();
    startRetryQueueLoop();
    mettreAJourBoutonMasterUI();

    fetch('config.json')
        .then(res => {
            if (!res.ok) throw new Error("Fichier config.json introuvable.");
            return res.json();
        })
        .then(config => {
            scriptUrl = config.scriptUrl;
            if (!scriptUrl) throw new Error("Propriété scriptUrl manquante dans config.json.");
            flushPendingQueue();
            loadDataFromSheet();
        })
        .catch(err => {
            console.error(err);
            document.getElementById('global-loader').innerHTML = `<div style="color:#f43f5e; text-align:center; padding:2rem;">Erreur de configuration : Impossible de charger le fichier <b>config.json</b> ou l'URL du script est invalide.<br><br>${err.message}</div>`;
        });
};

function startGlobalSync() {
    if (globalSyncTimer) clearInterval(globalSyncTimer);
    const interval = isMaster ? 15000 : 30000;

    globalSyncTimer = setInterval(() => {
        if (!scriptUrl) return;
        if (pendingRequests.length > 0) flushPendingQueue();

        fetch(scriptUrl)
            .then(res => res.json())
            .then(data => {
                appData.allStates = data.allStates || {};
                appData.tournoisTermines = data.tournoisTermines || {};
                appData.classementGeneralMTT = data.classementGeneralMTT || appData.classementGeneralMTT;
                appData.classementGeneralSNG = data.classementGeneralSNG || appData.classementGeneralSNG;
                if (data.structures) appData.structures = data.structures;

                if (data.inscriptions) {
                    if (Date.now() - lastLocalInscriptionTime < 20000) {
                        for (const tId in appData.inscriptions) {
                            if (!data.inscriptions[tId]) data.inscriptions[tId] = {};
                            for (const joueur in appData.inscriptions[tId]) {
                                if (data.inscriptions[tId][joueur] === undefined) {
                                    data.inscriptions[tId][joueur] = appData.inscriptions[tId][joueur];
                                }
                            }
                        }
                    }
                    appData.inscriptions = data.inscriptions;
                    const tabInsc = document.getElementById('tab-inscriptions');
                    if (tabInsc && !tabInsc.classList.contains('hidden') && tablesGenerees === null) {
                        updateInscritsUI();
                    }
                }

                if (!document.getElementById('tab-mtt').classList.contains('hidden')) {
                    renderClassementGeneralMTTUI();
                }
                if (!document.getElementById('tab-sng').classList.contains('hidden')) {
                    renderClassementGeneralSNGUI();
                }

                if (!document.getElementById('tab-classement').classList.contains('hidden') && !isDraggingClassement) {
                    renderClassementUI();
                }

                if (activeTournoiId) {
                    const remoteState = appData.allStates[activeTournoiId];
                    if (remoteState) {
                        if (!isMaster) {
                            syncRemoteLiveState(remoteState);
                        }
                    } else {
                        tablesGenerees = null;
                        tablesMeta = {};
                        liveActionHistory = [];
                        renderTablesUI();
                        renderLiveHistoryUI();
                    }
                }
            })
            .catch(err => console.error("Erreur sync globale arrière-plan:", err));
    }, interval);
}

function syncRemoteLiveState(state) {
    if (!state || isMaster) return;

    if (state.niveauActuel && state.niveauActuel !== niveauActuel) {
        niveauActuel = state.niveauActuel;
        jouerBipChangementNiveau();
    } else {
        niveauActuel = state.niveauActuel || 1;
    }

    tablesGenerees = state.tablesGenerees || null;
    tablesMeta = state.tablesMeta || {};
    ensureTablesMeta();
    joueursEliminesHistorique = state.joueursEliminesHistorique || [];
    if (Array.isArray(state.liveActionHistory)) {
        liveActionHistory = state.liveActionHistory;
    }
    totalJoueursInitial = state.totalJoueursInitial || 0;
    chronoIsRunning = state.chronoIsRunning || false;

    if (state.bloquerLastMinute !== undefined) {
        bloquerLastMinute = state.bloquerLastMinute;
        const chk = document.getElementById('chk-block-last-minute');
        if (chk) chk.checked = bloquerLastMinute;
    }

    const alertBox = document.getElementById('live-alertes');
    if (alertBox && state.derniereAlerte) {
        let consigneNettoyee = state.derniereAlerte.replace(/<button[^>]*>Compris<\/button>/gi, '');
        alertBox.innerHTML = consigneNettoyee;
        alertBox.className = consignesContiennentUneAlerte(state.derniereAlerte) ? "alert alert-action" : "alert";
    }

    if (chronoIsRunning && state.chronoEndTime) {
        chronoEndTime = state.chronoEndTime;
        const diff = Math.ceil((chronoEndTime - Date.now()) / 1000);
        if (diff > 0) secondesRestantes = diff;
        if (!chronoTimer) startChronoLoop(false);
    } else {
        if (chronoTimer) clearInterval(chronoTimer);
        chronoIsRunning = false;
        chronoEndTime = null;
        if (state.secondesRestantes !== undefined) secondesRestantes = state.secondesRestantes;
        const btn = document.getElementById('btn-chrono');
        if (btn) { btn.innerText = "Start"; btn.className = "btn-green"; }
    }

    updateChronoUI();
    renderTablesUI();
    renderLiveHistoryUI();
    recalculerStatistiquesLive();
}

function loadDataFromSheet() {
    if (!scriptUrl) return;

    fetch(scriptUrl)
        .then(res => res.json())
        .then(data => {
            appData = data;
            if (data.structures) appData.structures = data.structures;

            let actifDemare = null;
            let termineRecent = null;
            const now = Date.now();

            if (appData.tournois && appData.allStates) {
                for (const t of appData.tournois) {
                    const state = appData.allStates[t.id];
                    const estTermine = appData.tournoisTermines && appData.tournoisTermines[t.id];

                    if (state && (state.tablesGenerees || state.chronoIsRunning) && !estTermine) {
                        actifDemare = t.id;
                        break;
                    }

                    if (estTermine && t.date) {
                        const deadline = getDeadlineClassementLundi23h(t.date);
                        if (deadline && now < deadline) {
                            termineRecent = t.id;
                        }
                    }
                }
            }

            if (actifDemare) {
                appData.prochainTournoiId = actifDemare;
            } else if (termineRecent) {
                appData.prochainTournoiId = termineRecent;
            }

            populateDropdowns();
            mettreAJourBoutonMasterUI();

            if (data.allStates && activeTournoiId && data.allStates[activeTournoiId]) {
                restoreGameState(data.allStates[activeTournoiId]);
            } else {
                resetLocalState();
            }

            checkTournoiLockStatus();
            renderClassementGeneralMTTUI();
            renderClassementGeneralSNGUI();

            if (actifDemare) {
                switchTab('live');
            } else if (termineRecent) {
                switchTab('classement');
            }

            document.getElementById('global-loader').style.display = 'none';
            startGlobalSync();
        })
        .catch(err => {
            console.error(err);
            document.getElementById('global-loader').innerHTML = `<div style="color:#f43f5e; text-align:center; padding:2rem;">Erreur de chargement des données depuis Google Apps Script.<br><br>${err.toString()}</div>`;
        });
}

function resetLocalState() {
    tablesGenerees = null;
    tablesMeta = {};
    totalJoueursInitial = 0;
    joueursEliminesHistorique = [];
    liveActionHistory = [];
    bloquerLastMinute = false;
    const chk = document.getElementById('chk-block-last-minute');
    if (chk) chk.checked = false;
    niveauActuel = 1;
    dureeNiveauSec = getDureeStructureSec(1);
    secondesRestantes = dureeNiveauSec;
    chronoEndTime = null;
    chronoIsRunning = false;
    if (chronoTimer) clearInterval(chronoTimer);
    updateChronoUI();
    renderTablesUI();
    renderLiveHistoryUI();
}

function restoreGameState(state) {
    if (!state) return;
    tablesGenerees = state.tablesGenerees || null;
    tablesMeta = state.tablesMeta || {};
    ensureTablesMeta();
    totalJoueursInitial = state.totalJoueursInitial || 0;
    joueursEliminesHistorique = state.joueursEliminesHistorique || [];
    liveActionHistory = Array.isArray(state.liveActionHistory) ? state.liveActionHistory : [];
    bloquerLastMinute = state.bloquerLastMinute || false;
    const chk = document.getElementById('chk-block-last-minute');
    if (chk) chk.checked = bloquerLastMinute;
    
    niveauActuel = state.niveauActuel || 1;
    dureeNiveauSec = getDureeStructureSec(niveauActuel);
    secondesRestantes = state.secondesRestantes || dureeNiveauSec;
    chronoEndTime = state.chronoEndTime || null;
    chronoIsRunning = state.chronoIsRunning || false;

    if (chronoIsRunning && chronoEndTime) {
        const now = Date.now();
        const diffSec = Math.ceil((chronoEndTime - now) / 1000);
        
        if (diffSec > 0) {
            secondesRestantes = diffSec;
            startChronoLoop(false);
        } else {
            let tempsEcouleAbsolu = Math.floor((now - (chronoEndTime - (secondesRestantes * 1000))) / 1000);
            let niveauxPasses = Math.floor(tempsEcouleAbsolu / dureeNiveauSec);
            niveauActuel = Math.min(25, niveauActuel + niveauxPasses);
            dureeNiveauSec = getDureeStructureSec(niveauActuel);
            secondesRestantes = dureeNiveauSec - (tempsEcouleAbsolu % dureeNiveauSec);
            startChronoLoop(true);
        }
    } else {
        updateChronoUI();
    }
    renderTablesUI();
    renderLiveHistoryUI();
}

function saveGameStateToSheet() {
    if (!scriptUrl || !activeTournoiId || !isMaster) return;

    const remoteState = appData.allStates && appData.allStates[activeTournoiId];
    if (!tablesGenerees && remoteState && remoteState.tablesGenerees) {
        console.warn("Sauvegarde bloquée : tablesGenerees est null localement alors que des tables existent sur le serveur.");
        return;
    }

    ensureTablesMeta();
    const alertBox = document.getElementById('live-alertes');
    let consigneActuelle = alertBox ? alertBox.innerHTML : "";

    const state = {
        masterClientId: myClientId,
        tablesGenerees: tablesGenerees,
        tablesMeta: tablesMeta,
        totalJoueursInitial: totalJoueursInitial,
        joueursEliminesHistorique: joueursEliminesHistorique,
        liveActionHistory: liveActionHistory,
        bloquerLastMinute: bloquerLastMinute,
        niveauActuel: niveauActuel,
        secondesRestantes: secondesRestantes,
        chronoEndTime: chronoEndTime,
        chronoIsRunning: chronoIsRunning,
        derniereAlerte: consigneActuelle
    };

    if (!appData.allStates) appData.allStates = {};
    appData.allStates[activeTournoiId] = state;

    enqueuePostRequest({
        tournoiId: activeTournoiId,
        action: "saveState",
        masterToken: masterToken,
        state: state
    });
}

function checkTournoiLockStatus() {
    const hasVainqueur = appData.tournoisTermines && appData.tournoisTermines[activeTournoiId];

    const btnGenerer = document.getElementById('btn-generer-tables');
    if (tablesGenerees !== null) {
        btnGenerer.disabled = true;
        btnGenerer.className = "btn-disabled";
    } else {
        btnGenerer.disabled = false;
        btnGenerer.className = "btn-amber";
    }

    const btnReset = document.getElementById('btn-reset');
    if (hasVainqueur) {
        btnReset.disabled = true;
        btnReset.className = "btn-disabled";
        btnReset.title = "Reset impossible : le vainqueur de ce tournoi est déjà enregistré.";
    } else {
        btnReset.disabled = false;
        btnReset.className = "btn-rose";
        btnReset.title = "";
    }
}

function switchTab(tab) {
    ['inscriptions', 'tables', 'live', 'classement', 'mtt', 'sng'].forEach(t => {
        const el = document.getElementById(`tab-${t}`);
        const btn = document.getElementById(`btn-${t}`);
        if (el) el.classList.add('hidden');
        if (btn) {
            btn.style.backgroundColor = '#334155';
            btn.style.color = '#cbd5e1';
        }
    });
    const targetEl = document.getElementById(`tab-${tab}`);
    const targetBtn = document.getElementById(`btn-${tab}`);
    if (targetEl) targetEl.classList.remove('hidden');
    if (targetBtn) {
        targetBtn.style.backgroundColor = '#d97706';
        targetBtn.style.color = '#ffffff';
    }

    if (tab === 'live') initLive();
    else if (tab === 'classement') renderClassementUI();
    else if (tab === 'mtt') renderClassementGeneralMTTUI();
    else if (tab === 'sng') renderClassementGeneralSNGUI();
}
