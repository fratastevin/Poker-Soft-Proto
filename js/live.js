function recalculerStatistiquesLive() {
    let tousJoueursActifs = [];
    if (tablesGenerees) {
        for (const seats of Object.values(tablesGenerees)) {
            seats.forEach(s => { if (s.player) tousJoueursActifs.push(s.player); });
        }
    }

    if (totalJoueursInitial === 0 && tousJoueursActifs.length > 0) {
        totalJoueursInitial = tousJoueursActifs.length + joueursEliminesHistorique.length;
    }

    const restantsCount = tousJoueursActifs.length;
    const starting = appData.startingStack || 20000;
    const totalInscrits = totalJoueursInitial || restantsCount;
    const avgStack = restantsCount > 0 ? Math.round((starting * totalInscrits) / restantsCount) : starting;

    const elTotal = document.getElementById('stat-total');
    const elRestants = document.getElementById('stat-restants');
    const elTapisMoyen = document.getElementById('stat-tapis-moyen');

    if (elTotal) elTotal.innerText = totalInscrits;
    if (elRestants) elRestants.innerText = restantsCount;
    if (elTapisMoyen) elTapisMoyen.innerText = avgStack.toLocaleString();
}

function jouerBipChangementNiveau() {
    try {
        const audio = new Audio('bip.wav');
        audio.volume = 1;
        audio.play().catch(e => console.log("Lecture audio bloquée (interaction requise) :", e));
    } catch (e) {}
}

function consignesContiennentUneAlerte(htmlTexte) {
    return htmlTexte.includes("CASSAGE") || htmlTexte.includes("RÉÉQUILIBRAGE") || htmlTexte.includes("TABLE FINALE") || htmlTexte.includes("⚠️") || htmlTexte.includes("🚨") || htmlTexte.includes("🏆");
}

function initLive() {
    recalculerStatistiquesLive();

    const tour = getActiveTournoi();
    const isSNG = (tour && tour.type === 'SNG');
    const dejaClassesSet = new Set(joueursEliminesHistorique.map(item => item.joueur));

    let tousJoueursActifs = [];
    if (tablesGenerees) {
        for (const seats of Object.values(tablesGenerees)) {
            seats.forEach(s => {
                if (s.player) {
                    // En SNG, exclure les joueurs déjà 1ers de table (vainqueurs)
                    if (isSNG && dejaClassesSet.has(s.player)) return;
                    tousJoueursActifs.push(s.player);
                }
            });
        }
    }

    const selElim = document.getElementById('select-eliminer');
    if (selElim) {
        selElim.innerHTML = '<option value="" disabled selected>-- Sélectionnez un joueur --</option>';
        tousJoueursActifs.sort((a,b) => a.localeCompare(b)).forEach(j => {
            selElim.innerHTML += `<option value="${j}">${j}</option>`;
        });
    }

    const selReint = document.getElementById('select-reintegrer');
    if (selReint) {
        selReint.innerHTML = '<option value="" disabled selected>-- Sélectionnez un joueur --</option>';
        if (joueursEliminesHistorique.length > 0) {
            [...joueursEliminesHistorique].reverse().forEach(item => {
                const tLabel = item.origTableId ? ` · ${getTableDisplayName(item.origTableId)}` : '';
                selReint.innerHTML += `<option value="${item.joueur}">${item.joueur} (Place: ${item.classement}${tLabel})</option>`;
            });
        }
    }

    if (tablesGenerees) {
        verifierEtReequilibrer();
    }
    updateChronoUI();
}

function marquerAlerteCompris() {
    if (!checkMastershipBeforeAction()) return;
    alerteIgnoree = true;
    const alertBox = document.getElementById('live-alertes');
    const eqSpan = document.getElementById('stat-equilibre');
    alertBox.innerHTML = "Tournoi en cours. Consigne acquittée.";
    alertBox.className = "alert";
    eqSpan.innerText = "OK";
    eqSpan.style.color = "#34d399";
}

function verifierEtReequilibrer() {
    if (!tablesGenerees) return;

    const tour = getActiveTournoi();
    const isSNG = (tour && tour.type === 'SNG');

    if (isSNG) {
        const eqSpan = document.getElementById('stat-equilibre');
        const alertBox = document.getElementById('live-alertes');
        eqSpan.innerText = "FIXE (SNG)";
        eqSpan.style.color = "#34d399";
        alertBox.innerHTML = "Tournoi SNG en cours. Tables fixes, pas de rééquilibrage.";
        alertBox.className = "alert";

        let changedSNG = false;
        for (const [tId, seats] of Object.entries(tablesGenerees)) {
            let actifsTable = seats.filter(s => s.player !== null);
            if (actifsTable.length === 1) {
                let dernierTable = actifsTable[0].player;
                let dejaEnregistre = joueursEliminesHistorique.some(item => item.joueur === dernierTable);
                if (!dejaEnregistre && isMaster) {
                    const seatWinner = seats.find(s => s.player === dernierTable);
                    const validTableNum = String(tId);
                    joueursEliminesHistorique.push({
                        joueur: dernierTable,
                        classement: 1,
                        origTableId: validTableNum,
                        origSeat: seatWinner ? seatWinner.seat : null
                    });
                    if (seatWinner) seatWinner.player = null;
                    changedSNG = true;

                    if (scriptUrl && activeTournoiId) {
                        enqueuePostRequest({
                            tournoiId: activeTournoiId,
                            joueur: dernierTable,
                            action: "eliminer",
                            masterToken: masterToken,
                            classement: 1,
                            tableNum: validTableNum
                        }, { notifyErrorOnce: true });
                    }
                }
            }
        }
        if (changedSNG && isMaster) {
            renderTablesUI();
            saveGameStateToSheet();
        }
        return;
    }

    const maxPerTable = appData.maxJoueursParTable || 6;
    const finalTableSize = getFinalTableSize(maxPerTable);
    let tablesActivesIds = [];
    let totalJoueursActifs = 0;

    for (const [tId, seats] of Object.entries(tablesGenerees)) {
        const count = seats.filter(s => s.player !== null).length;
        if (count > 0) {
            tablesActivesIds.push(tId);
            totalJoueursActifs += count;
        }
    }

    if (totalJoueursActifs === 0) return;

    if (totalJoueursActifs === 1 && !appData.tournoisTermines[activeTournoiId]) {
        let dernierJoueur = null;
        let winnerTableId = null;
        let winnerSeat = null;

        for (const [tId, seats] of Object.entries(tablesGenerees)) {
            const s = seats.find(seat => seat.player !== null);
            if (s) {
                dernierJoueur = s.player;
                winnerTableId = tId;
                winnerSeat = s;
                break;
            }
        }

        if (dernierJoueur && isMaster) {
            if (chronoIsRunning) toggleChrono();

            const dejaClasse = joueursEliminesHistorique.some(item => item.joueur === dernierJoueur);
            if (!dejaClasse) {
                joueursEliminesHistorique.push({
                    joueur: dernierJoueur,
                    classement: 1,
                    origTableId: String(winnerTableId),
                    origSeat: winnerSeat.seat
                });
            }
            winnerSeat.player = null;

            appData.tournoisTermines[activeTournoiId] = dernierJoueur;
            checkTournoiLockStatus();
            renderTablesUI();
            recalculerStatistiquesLive();

            const selElim = document.getElementById('select-eliminer');
            if (selElim) selElim.innerHTML = '<option value="" disabled selected>-- Tournoi terminé --</option>';

            const alertBox = document.getElementById('live-alertes');
            if (alertBox) {
                alertBox.innerHTML = `🏆 <b>TOURNOI TERMINÉ !</b><br>Vainqueur : <b>${dernierJoueur}</b>`;
                alertBox.className = "alert alert-action";
            }

            if (scriptUrl && activeTournoiId) {
                enqueuePostRequest({
                    tournoiId: activeTournoiId,
                    joueur: dernierJoueur,
                    action: "eliminer",
                    masterToken: masterToken,
                    classement: 1,
                    tableNum: String(winnerTableId)
                });
                saveGameStateToSheet();
                setTimeout(() => {
                    loadDataFromSheet();
                }, 2000);
            }

            alert(`🏆 TOURNOI TERMINÉ !\n\nVainqueur : ${dernierJoueur}.\nLe classement général va être mis à jour.`);
            switchTab('classement');
            return;
        }
    }

    const nbTablesNecessaires = (totalJoueursActifs <= finalTableSize) ? 1 : Math.ceil(totalJoueursActifs / maxPerTable);
    const alertBox = document.getElementById('live-alertes');
    const eqSpan = document.getElementById('stat-equilibre');

    if (nbTablesNecessaires < tablesActivesIds.length) {
        const isFinalTableBreak = (nbTablesNecessaires === 1);
        eqSpan.innerText = isFinalTableBreak ? "TABLE FINALE" : "CASSAGE APPLIQUÉ";
        eqSpan.style.color = isFinalTableBreak ? "#fbbf24" : "#f43f5e";

        const randIndex = Math.floor(Math.random() * tablesActivesIds.length);
        const tableAFermerId = tablesActivesIds[randIndex];
        const joueursAFermer = tablesGenerees[tableAFermerId].filter(s => s.player !== null).map(s => s.player);

        if (isFinalTableBreak) {
            const tableFinaleId = tablesActivesIds.find(id => id !== tableAFermerId);
            if (tableFinaleId && tablesGenerees[tableFinaleId].length < finalTableSize) {
                for (let s = tablesGenerees[tableFinaleId].length + 1; s <= finalTableSize; s++) {
                    tablesGenerees[tableFinaleId].push({ seat: s, player: null });
                }
            }
        }

        let siegesLibres = [];
        tablesActivesIds.forEach(tId => {
            if (tId !== tableAFermerId) {
                tablesGenerees[tId].forEach(s => {
                    if (s.player === null) {
                        siegesLibres.push({ tableId: tId, seat: s.seat });
                    }
                });
            }
        });

        siegesLibres.sort(() => Math.random() - 0.5);
        let consignes = isFinalTableBreak 
            ? `🏆 <b>CONSTITUTION DE LA TABLE FINALE (${totalJoueursActifs} JOUEURS)</b><br>Fermeture ${getTableDisplayName(tableAFermerId)} — Joueurs replacés :<br>`
            : `🚨 <b>CASSAGE DE TABLE EFFECTUÉ (FERMETURE ${getTableDisplayName(tableAFermerId)})</b><br>Joueurs replacés :<br>`;

        joueursAFermer.forEach((j, idx) => {
            if (siegesLibres[idx]) {
                const destination = siegesLibres[idx];
                consignes += `• <b>${j}</b> ➔ ${getTableDisplayName(destination.tableId)}, Siège ${destination.seat}<br>`;
                
                tablesGenerees[tableAFermerId].find(s => s.player === j).player = null;
                tablesGenerees[destination.tableId].find(s => s.seat === destination.seat).player = j;
            }
        });

        consignes += `<br><button onclick="marquerAlerteCompris()" style="background:#d97706; color:white; padding:0.25rem 0.5rem; border-radius:0.25rem; font-size:0.75rem; width:auto;">Compris</button>`;

        alertBox.innerHTML = consignes;
        alertBox.className = "alert alert-action";
        renderTablesUI();
        if (isMaster) saveGameStateToSheet();
        return;
    }

    let minJoueurs = Infinity, maxJoueurs = -1;
    let tablePlusPetiteId = null, tablePlusGrandeId = null;

    tablesActivesIds.forEach(tId => {
        const count = tablesGenerees[tId].filter(s => s.player !== null).length;
        if (count < minJoueurs) { minJoueurs = count; tablePlusPetiteId = tId; }
        if (count > maxJoueurs) { maxJoueurs = count; tablePlusGrandeId = tId; }
    });

    if (maxJoueurs - minJoueurs >= 2) {
        eqSpan.innerText = "RÉÉQUILIBRAGE APPLIQUÉ";
        eqSpan.style.color = "#fbbf24";

        const joueursGrandeTable = tablesGenerees[tablePlusGrandeId].filter(s => s.player !== null).map(s => s.player);
        const joueurADeplacer = joueursGrandeTable[Math.floor(Math.random() * joueursGrandeTable.length)];
        const siegeLibre = tablesGenerees[tablePlusPetiteId].find(s => s.player === null);

        let consignes = `⚠️ <b>RÉÉQUILIBRAGE EFFECTUÉ (Écart ≥ 2)</b><br>`;
        consignes += `<b>${joueurADeplacer}</b> a été déplacé de ${getTableDisplayName(tablePlusGrandeId)} vers ${getTableDisplayName(tablePlusPetiteId)} (Siège ${siegeLibre.seat}).<br><br>`;
        consignes += `<button onclick="marquerAlerteCompris()" style="background:#d97706; color:white; padding:0.25rem 0.5rem; border-radius:0.25rem; font-size:0.75rem; width:auto;">Compris</button>`;

        tablesGenerees[tablePlusGrandeId].find(s => s.player === joueurADeplacer).player = null;
        siegeLibre.player = joueurADeplacer;

        alertBox.innerHTML = consignes;
        alertBox.className = "alert alert-action";
        renderTablesUI();
        if (isMaster) saveGameStateToSheet();
        return;
    }

    if (alerteIgnoree) {
        eqSpan.innerText = "OK";
        eqSpan.style.color = "#34d399";
        alertBox.innerHTML = "Tournoi en cours. Toutes les tables sont équilibrées.";
        alertBox.className = "alert";
    } else {
        eqSpan.innerText = "PARFAIT";
        eqSpan.style.color = "#34d399";
        alertBox.innerHTML = "Tournoi en cours. Toutes les tables sont parfaitement équilibrées.";
        alertBox.className = "alert";
    }
}

function updateChronoUI() {
    let m = Math.floor(secondesRestantes / 60);
    let s = secondesRestantes % 60;
    document.getElementById('live-chrono').innerText = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    
    const tournoi = getActiveTournoi();
    const type = (tournoi && tournoi.type === 'SNG') ? 'SNG' : 'MTT';
    const structs = (appData.structures && appData.structures[type]) ? appData.structures[type] : {};
    const currentStruct = structs[niveauActuel] || {label: `Niveau ${niveauActuel}`, sb: 0, bb: 0, ante: 0};
    
    document.getElementById('live-niveau').innerText = currentStruct.label;
    document.getElementById('live-blinds').innerText = currentStruct.isPause ? "PAUSE" : `${currentStruct.sb} / ${currentStruct.bb} (Ante ${currentStruct.ante})`;

    const nextStruct = structs[niveauActuel + 1];
    if (nextStruct) {
        document.getElementById('stat-suivant').innerText = nextStruct.label + (nextStruct.isPause ? "" : ` (${nextStruct.sb}/${nextStruct.bb})`);
    } else {
        document.getElementById('stat-suivant').innerText = "Dernier niveau";
    }
}

function startChronoLoop(save = true) {
    chronoIsRunning = true;
    const btn = document.getElementById('btn-chrono');
    if (btn) { btn.innerText = "Pause"; btn.className = "btn-amber"; }

    if (!chronoEndTime) chronoEndTime = Date.now() + (secondesRestantes * 1000);
    if (chronoTimer) clearInterval(chronoTimer);

    chronoTimer = setInterval(() => {
        const diff = Math.ceil((chronoEndTime - Date.now()) / 1000);
        if (diff > 0) {
            secondesRestantes = diff;
            updateChronoUI();
        } else {
            clearInterval(chronoTimer);
            chronoIsRunning = false;
            chronoEndTime = null;
            
            const tournoi = getActiveTournoi();
            const type = (tournoi && tournoi.type === 'SNG') ? 'SNG' : 'MTT';
            const structs = (appData.structures && appData.structures[type]) ? appData.structures[type] : {};
            if (structs[niveauActuel + 1]) {
                niveauActuel++;
                dureeNiveauSec = getDureeStructureSec(niveauActuel);
                secondesRestantes = dureeNiveauSec;
                jouerBipChangementNiveau();
                startChronoLoop(true);
            } else {
                alert("🏁 Fin de la structure des niveaux !");
            }
        }
    }, 1000);

    updateChronoUI();
    if (save && isMaster) saveGameStateToSheet();
}

function toggleChrono() {
    if (!checkMastershipBeforeAction()) return;

    if (chronoIsRunning) {
        clearInterval(chronoTimer);
        chronoIsRunning = false;
        chronoEndTime = null;
        const btn = document.getElementById('btn-chrono');
        if (btn) { btn.innerText = "Start"; btn.className = "btn-green"; }
        updateChronoUI();
        saveGameStateToSheet();
    } else {
        chronoEndTime = Date.now() + (secondesRestantes * 1000);
        startChronoLoop(true);
    }
}

function resetChrono() {
    if (!checkMastershipBeforeAction()) return;

    if (appData.tournoisTermines && appData.tournoisTermines[activeTournoiId]) {
        alert("⚠️ Reset impossible : ce tournoi est terminé.");
        return;
    }

    if (!confirm("⚠️ RESET COMPLET DU TOURNOI :\n\n- Le chrono repassera au début.\n- Tous les joueurs éliminés seront réintégrés.\n- Leurs classements enregistrés sur Google Sheet seront effacés.\n- Les plans de table pourront être refaits.\n\nConfirmez-vous cette réinitialisation ?")) {
        return;
    }

    clearInterval(chronoTimer);
    chronoIsRunning = false;
    chronoEndTime = null;
    niveauActuel = 1;
    dureeNiveauSec = getDureeStructureSec(1);
    secondesRestantes = dureeNiveauSec;

    const btn = document.getElementById('btn-chrono');
    if (btn) { btn.innerText = "Start"; btn.className = "btn-green"; }
    updateChronoUI();

    if (joueursEliminesHistorique.length > 0 && tablesGenerees) {
        joueursEliminesHistorique.forEach(item => {
            let placeRemise = false;
            if (tablesGenerees[item.origTableId]) {
                const sOrig = tablesGenerees[item.origTableId].find(s => s.seat == item.origSeat);
                if (sOrig && sOrig.player === null) {
                    sOrig.player = item.joueur;
                    placeRemise = true;
                }
            }
            if (!placeRemise) {
                for (const seats of Object.values(tablesGenerees)) {
                    const sLibre = seats.find(s => s.player === null);
                    if (sLibre) {
                        sLibre.player = item.joueur;
                        break;
                    }
                }
            }
        });
    }

    joueursEliminesHistorique = [];
    tablesGenerees = null;
    tablesMeta = {};
    renderTablesUI();
    checkTournoiLockStatus();
    initLive();
    saveGameStateToSheet();

    if (scriptUrl && activeTournoiId) {
        enqueuePostRequest({ tournoiId: activeTournoiId, action: "resetTournament", masterToken: masterToken });
    }
}

function promptNextLevel() {
    if (!checkMastershipBeforeAction()) return;
    const choix = prompt("Changement de niveau :\n\n1. Conserver le compte à rebours actuel\n2. Remettre le chrono à zéro (pour le nouveau niveau)\n3. Annuler\n\nTapez 1, 2 ou 3 :", "2");
    if (choix === "1") changeLevelBy(1, false);
    else if (choix === "2") changeLevelBy(1, true);
}

function promptPrevLevel() {
    if (!checkMastershipBeforeAction()) return;
    const choix = prompt("Retour en arrière (Niveau -) :\n\n1. Conserver le compte à rebours actuel\n2. Remettre le chrono à zéro\n3. Annuler\n\nTapez 1, 2 ou 3 :", "2");
    if (choix === "1") changeLevelBy(-1, false);
    else if (choix === "2") changeLevelBy(-1, true);
}

function changeLevelBy(delta, resetTime) {
    const newNiveau = niveauActuel + delta;
    const tournoi = getActiveTournoi();
    const type = (tournoi && tournoi.type === 'SNG') ? 'SNG' : 'MTT';
    const structs = (appData.structures && appData.structures[type]) ? appData.structures[type] : {};
    if (newNiveau >= 1 && structs[newNiveau]) {
        niveauActuel = newNiveau;
        dureeNiveauSec = getDureeStructureSec(niveauActuel);
        if (resetTime) secondesRestantes = dureeNiveauSec;
        
        jouerBipChangementNiveau();
        chronoEndTime = chronoIsRunning ? (Date.now() + (secondesRestantes * 1000)) : null;
        updateChronoUI();
        
        if (chronoIsRunning) startChronoLoop(true);
        else saveGameStateToSheet();
    }
}

function eliminerJoueur() {
    if (!checkMastershipBeforeAction()) return;
    const joueur = document.getElementById('select-eliminer').value;
    if (!joueur) return;

    // Garde anti-doublon : un joueur déjà classé ne peut pas être éliminé une 2e fois
    if (joueursEliminesHistorique.some(item => item.joueur === joueur)) {
        alert(`⚠️ ${joueur} est déjà enregistré dans le classement de ce tournoi.`);
        return;
    }

    if (!confirm(`Confirmez-vous l'élimination définitive de ${joueur} ?`)) return;

    const tour = getActiveTournoi();
    const isSNG = (tour && tour.type === 'SNG');

    let restantsCount = 0;
    let origTableId = null, origSeat = null;

    if (tablesGenerees) {
        for (const [tId, seats] of Object.entries(tablesGenerees)) {
            seats.forEach(s => {
                if (s.player) {
                    restantsCount++;
                    if (s.player === joueur) {
                        origTableId = String(tId);
                        origSeat = s.seat;
                    }
                }
            });
        }
    }

    let classementAttribue = Math.max(1, restantsCount);
    let dernierJoueurTableSNG = null;
    let dernierSeatTableSNG = null;

    if (isSNG) {
        if (!origTableId && tablesGenerees) {
            for (const [tId, seats] of Object.entries(tablesGenerees)) {
                if (seats.some(s => s.player === joueur)) {
                    origTableId = String(tId);
                    break;
                }
            }
        }
        if (!origTableId) {
            alert("❌ Impossible d'identifier la table du joueur en SNG (table manquante). Élimination annulée.");
            return;
        }

        const tableSeats = tablesGenerees[origTableId] || [];
        const autresActifs = tableSeats.filter(s => s.player !== null && s.player !== joueur);
        classementAttribue = autresActifs.length + 1;

        // S'il ne reste qu'un seul autre joueur sur cette table SNG, il devient implicitement 1er de la table
        if (autresActifs.length === 1) {
            dernierJoueurTableSNG = autresActifs[0].player;
            dernierSeatTableSNG = autresActifs[0].seat;
        }
    }

    joueursEliminesHistorique.push({ joueur, classement: classementAttribue, origTableId, origSeat });

    if (tablesGenerees && origTableId && tablesGenerees[origTableId]) {
        const seatObj = tablesGenerees[origTableId].find(s => s.seat == origSeat);
        if (seatObj) seatObj.player = null;
    }

    // Enregistrement implicite du 1er de la table SNG lorsqu'on élimine le 2e
    if (isSNG && dernierJoueurTableSNG) {
        const dejaPremier = joueursEliminesHistorique.some(item => item.joueur === dernierJoueurTableSNG);
        if (!dejaPremier) {
            joueursEliminesHistorique.push({
                joueur: dernierJoueurTableSNG,
                classement: 1,
                origTableId: origTableId,
                origSeat: dernierSeatTableSNG
            });
        }
        const lastSeatObj = tablesGenerees[origTableId].find(s => s.seat == dernierSeatTableSNG);
        if (lastSeatObj) lastSeatObj.player = null;
    }

    renderTablesUI();
    initLive();
    saveGameStateToSheet();

    if (scriptUrl && activeTournoiId) {
        const elimPayload = {
            tournoiId: activeTournoiId,
            joueur,
            action: "eliminer",
            masterToken: masterToken,
            classement: classementAttribue
        };
        if (origTableId) elimPayload.tableNum = origTableId;

        enqueuePostRequest(elimPayload, { notifyErrorOnce: true });

        if (isSNG && dernierJoueurTableSNG && origTableId) {
            enqueuePostRequest({
                tournoiId: activeTournoiId,
                joueur: dernierJoueurTableSNG,
                action: "eliminer",
                masterToken: masterToken,
                classement: 1,
                tableNum: origTableId
            }, { notifyErrorOnce: true });
        }
    }
}

function reintegrerJoueur() {
    if (!checkMastershipBeforeAction()) return;
    const joueur = document.getElementById('select-reintegrer').value;
    if (!joueur) return;

    if (!confirm(`Voulez-vous vraiment réintégrer ${joueur} au tournoi ? Son classement sera annulé.`)) return;

    const idx = joueursEliminesHistorique.findIndex(item => item.joueur === joueur);
    if (idx === -1) return;

    const elemReintegre = joueursEliminesHistorique[idx];
    const classementsAncien = elemReintegre.classement;
    joueursEliminesHistorique.splice(idx, 1);

    const tour = getActiveTournoi();
    const isSNG = (tour && tour.type === 'SNG');

    let eliminationsFutures = [];
    if (!isSNG) {
        joueursEliminesHistorique.forEach(item => {
            if (item.classement > classementsAncien) {
                item.classement--;
                eliminationsFutures.push({ joueur: item.joueur, nouveauClassement: item.classement });
            }
        });
    }

    let remplace = false;
    if (tablesGenerees) {
        if (elemReintegre.origTableId && tablesGenerees[elemReintegre.origTableId]) {
            const targetSeat = tablesGenerees[elemReintegre.origTableId].find(s => s.seat == elemReintegre.origSeat);
            if (targetSeat && targetSeat.player === null) {
                targetSeat.player = joueur;
                remplace = true;
            }
        }
        if (!remplace) {
            for (const seats of Object.values(tablesGenerees)) {
                const sLibre = seats.find(s => s.player === null);
                if (sLibre) {
                    sLibre.player = joueur;
                    remplace = true;
                    break;
                }
            }
        }
    }

    renderTablesUI();
    initLive();
    saveGameStateToSheet();

    if (scriptUrl && activeTournoiId) {
        enqueuePostRequest({ tournoiId: activeTournoiId, joueur, action: "reintegrer", masterToken: masterToken, eliminationsFutures });
    }
}
