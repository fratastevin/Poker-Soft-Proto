function populateDropdowns() {
    const selJ = document.getElementById('select-joueur');
    selJ.innerHTML = '<option value="" disabled selected>-- Sélectionnez un joueur --</option>';
    const joueursTries = [...appData.joueurs].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
    joueursTries.forEach(j => {
        selJ.innerHTML += `<option value="${j}">${j}</option>`;
    });

    const selT = document.getElementById('select-tournoi');
    selT.innerHTML = '';
    appData.tournois.forEach(t => {
        const isSelected = (t.id === appData.prochainTournoiId) ? 'selected' : '';
        selT.innerHTML += `<option value="${t.id}" ${isSelected}>${t.displayLabel}</option>`;
    });

    activeTournoiId = appData.prochainTournoiId || (appData.tournois[0] ? appData.tournois[0].id : null);
    selT.value = activeTournoiId;

    updateInscritsUI();
}

function onTournoiChange() {
    activeTournoiId = document.getElementById('select-tournoi').value;
    
    if (appData.allStates && appData.allStates[activeTournoiId]) {
        restoreGameState(appData.allStates[activeTournoiId]);
    } else {
        resetLocalState();
    }
    updateInscritsUI();
    checkTournoiLockStatus();
}

function onToggleBlockLastMinute(checkbox) {
    if (!checkMastershipBeforeAction()) {
        checkbox.checked = !checkbox.checked;
        return;
    }
    bloquerLastMinute = checkbox.checked;
    saveGameStateToSheet();
}

async function ouvrirModalAjoutJoueur() {
    let clubPassword = "";
    if (!isMaster) {
        clubPassword = await demanderMotDePasseClubAsync();
        if (!clubPassword) return;
    }

    const nomNouveau = prompt("Entrez le pseudo du nouveau joueur :");
    if (!nomNouveau || nomNouveau.trim() === "") return;

    const cleanNom = nomNouveau.trim();
    if (appData.joueurs.includes(cleanNom)) {
        alert("Ce joueur existe déjà dans la liste.");
        return;
    }

    appData.joueurs.push(cleanNom);
    appData.joueurs.sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
    populateDropdowns();

    document.getElementById('select-joueur').value = cleanNom;
    inscrireJoueurWithPassword(clubPassword);

    if (scriptUrl) {
        enqueuePostRequest({ action: "ajouterJoueur", clubPassword: clubPassword, masterToken: isMaster ? masterToken : null, joueur: cleanNom });
    }
}

function updateInscritsUI() {
    const list = document.getElementById('list-inscrits');
    list.innerHTML = '';
    const tournoiInsc = appData.inscriptions[activeTournoiId] || {};

    let inscritsNoms = Array.isArray(tournoiInsc) ? [...tournoiInsc] : Object.keys(tournoiInsc);
    inscritsNoms.sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

    inscritsNoms.forEach(j => {
        const info = (typeof tournoiInsc[j] === 'object' && tournoiInsc[j] !== null) ? tournoiInsc[j] : { present: false };
        const isPresent = info.present;
        const badgeClass = isPresent ? "badge badge-present" : "badge badge-absent";
        const badgeText = isPresent ? "Présent" : "Absent";
        const safePlayer = j.replace(/'/g, "\\'");
        
        list.innerHTML += `
            <li>
                <span>${j}</span>
                <div style="display:flex; gap:0.5rem; align-items:center;">
                    <span class="${badgeClass}" onclick="togglePresence('${safePlayer}')">${badgeText}</span>
                    <button onclick="demanderAuthClubEtDesinscrire('${safePlayer}')" style="background:#e11d48; color:white; border:none; padding:0.25rem 0.5rem; border-radius:0.25rem; font-size:0.75rem; width:auto; margin:0;" title="Désinscrire">✕</button>
                </div>
            </li>
        `;
    });
    document.getElementById('count-inscrits').innerText = inscritsNoms.length;
    renderTablesUI();
}

async function inscrireJoueur() {
    const joueur = document.getElementById('select-joueur').value;
    if (!joueur) {
        alert("Veuillez sélectionner un joueur dans la liste.");
        return;
    }

    if (!appData.inscriptions[activeTournoiId]) appData.inscriptions[activeTournoiId] = {};
    const tournoiInsc = appData.inscriptions[activeTournoiId];
    const isAlreadyInscrit = Array.isArray(tournoiInsc) ? tournoiInsc.includes(joueur) : tournoiInsc.hasOwnProperty(joueur);
    
    if (isAlreadyInscrit) {
        alert(`${joueur} est déjà inscrit à ce tournoi.`);
        return;
    }

    let clubPassword = "";
    if (!isMaster) {
        clubPassword = await demanderMotDePasseClubAsync();
        if (!clubPassword) return;
    }

    lastLocalInscriptionTime = Date.now();

    if (tablesGenerees !== null) {
        if (bloquerLastMinute) {
            alert("❌ Les inscriptions de dernière minute sont bloquées pour ce tournoi.");
            return;
        }
        if (!checkMastershipBeforeAction()) return;
        inscrireDerniereMinute(joueur, clubPassword);
    } else {
        if (Array.isArray(tournoiInsc)) {
            appData.inscriptions[activeTournoiId].push(joueur);
        } else {
            appData.inscriptions[activeTournoiId][joueur] = { present: false };
        }
        updateInscritsUI();

        if (scriptUrl && activeTournoiId) {
            enqueuePostRequest({ 
                tournoiId: activeTournoiId, 
                joueur: joueur, 
                action: "inscrire", 
                clubPassword: clubPassword,
                masterToken: isMaster ? masterToken : null 
            });
        }
    }
    document.getElementById('select-joueur').selectedIndex = 0;
}

async function desinscrireJoueurAction() {
    const joueur = document.getElementById('select-joueur').value;
    if (!joueur) {
        alert("Veuillez sélectionner un joueur dans la liste.");
        return;
    }

    if (!appData.inscriptions[activeTournoiId]) appData.inscriptions[activeTournoiId] = {};
    const tournoiInsc = appData.inscriptions[activeTournoiId];
    const isAlreadyInscrit = Array.isArray(tournoiInsc) ? tournoiInsc.includes(joueur) : tournoiInsc.hasOwnProperty(joueur);
    
    if (!isAlreadyInscrit) {
        alert(`${joueur} n'est pas inscrit à ce tournoi.`);
        return;
    }

    let clubPassword = "";
    if (!isMaster) {
        clubPassword = await demanderMotDePasseClubAsync();
        if (!clubPassword) return;
    }

    lastLocalInscriptionTime = Date.now();
    desinscrireJoueurDirect(joueur, clubPassword);
    document.getElementById('select-joueur').selectedIndex = 0;
}

async function inscrireJoueurWithPassword(clubPassword) {
    const joueur = document.getElementById('select-joueur').value;
    if (!joueur) return;

    if (!appData.inscriptions[activeTournoiId]) appData.inscriptions[activeTournoiId] = {};
    const tournoiInsc = appData.inscriptions[activeTournoiId];

    if (Array.isArray(tournoiInsc)) {
        appData.inscriptions[activeTournoiId].push(joueur);
    } else {
        appData.inscriptions[activeTournoiId][joueur] = { present: false };
    }
    lastLocalInscriptionTime = Date.now();
    updateInscritsUI();

    if (scriptUrl && activeTournoiId) {
        enqueuePostRequest({ 
            tournoiId: activeTournoiId, 
            joueur: joueur, 
            action: "inscrire", 
            clubPassword: clubPassword,
            masterToken: isMaster ? masterToken : null 
        });
    }
}

async function demanderAuthClubEtDesinscrire(joueur) {
    let clubPassword = "";
    if (!isMaster) {
        clubPassword = await demanderMotDePasseClubAsync();
        if (!clubPassword) return;
    } else {
        if (!checkMastershipBeforeAction()) return;
    }
    desinscrireJoueurDirect(joueur, clubPassword);
}

function inscrireDerniereMinute(joueur, clubPassword) {
    if (!appData.inscriptions[activeTournoiId]) appData.inscriptions[activeTournoiId] = {};
    appData.inscriptions[activeTournoiId][joueur] = { present: true };
    totalJoueursInitial++;
    lastLocalInscriptionTime = Date.now();

    let plusPetiteTableId = null;
    let minJoueurs = Infinity;

    for (const [tId, seats] of Object.entries(tablesGenerees)) {
        const actifsCount = seats.filter(s => s.player !== null).length;
        const capaciteTable = seats.length;
        if (actifsCount < capaciteTable && actifsCount < minJoueurs) {
            minJoueurs = actifsCount;
            plusPetiteTableId = tId;
        }
    }

    if (plusPetiteTableId !== null) {
        const siegeLibre = tablesGenerees[plusPetiteTableId].find(s => s.player === null);
        if (siegeLibre) {
            siegeLibre.player = joueur;
            alert(`✅ ${joueur} a été ajouté à ${getTableDisplayName(plusPetiteTableId)} (Siège ${siegeLibre.seat}).`);
        }
    } else {
        const choix = prompt(`⚠️ Toutes les tables sont pleines !\n\nChoisissez une option :\n1. Réagencer les tables.\n2. Accepter en extra exceptionnel.\n3. Refuser l'inscription.\n\nTapez 1, 2 ou 3 :`, "1");
        
        if (choix === "1") {
            let tousActifs = [joueur];
            for (const seats of Object.values(tablesGenerees)) {
                seats.forEach(s => { if (s.player) tousActifs.push(s.player); });
            }
            repartirTablesRecalculees(tousActifs);
            alert(`🔄 Tables réagencées pour intégrer ${joueur}.`);
        } else if (choix === "2") {
            tablesGenerees[1].push({ seat: tablesGenerees[1].length + 1, player: joueur });
            alert(`➕ ${joueur} accepté en extra sur ${getTableDisplayName(1)}.`);
        } else {
            if (Array.isArray(appData.inscriptions[activeTournoiId])) {
                appData.inscriptions[activeTournoiId] = appData.inscriptions[activeTournoiId].filter(x => x !== joueur);
            } else {
                delete appData.inscriptions[activeTournoiId][joueur];
            }
            totalJoueursInitial--;
            alert(`❌ Inscription refusée.`);
            return;
        }
    }

    updateInscritsUI();
    saveGameStateToSheet();

    if (scriptUrl && activeTournoiId) {
        enqueuePostRequest({ 
            tournoiId: activeTournoiId, 
            joueur: joueur, 
            action: "inscrire", 
            clubPassword: clubPassword,
            masterToken: isMaster ? masterToken : null 
        });
        enqueuePostRequest({ tournoiId: activeTournoiId, joueur: joueur, action: "present", present: true, masterToken: masterToken });
    }
}

function desinscrireJoueurDirect(joueur, clubPassword) {
    const isTournoiStarted = tablesGenerees !== null;

    if (isTournoiStarted && !isMaster) {
        alert("❌ Le tournoi a déjà démarré. Seul le Maître du tournoi peut retirer un joueur.");
        return;
    }

    if (isTournoiStarted) {
        let trouveTable = false;
        for (const [tId, seats] of Object.entries(tablesGenerees)) {
            const seatObj = seats.find(s => s.player === joueur);
            if (seatObj) {
                seatObj.player = null;
                trouveTable = true;
                break;
            }
        }
        if (trouveTable) totalJoueursInitial--;
    }

    const tournoiInsc = appData.inscriptions[activeTournoiId] || {};
    if (Array.isArray(tournoiInsc)) {
        appData.inscriptions[activeTournoiId] = tournoiInsc.filter(x => x !== joueur);
    } else {
        delete tournoiInsc[joueur];
    }
    lastLocalInscriptionTime = Date.now();

    updateInscritsUI();
    if (isTournoiStarted && isMaster) {
        verifierEtReequilibrer();
        saveGameStateToSheet();
    }

    if (scriptUrl && activeTournoiId) {
        enqueuePostRequest({ 
            tournoiId: activeTournoiId, 
            joueur: joueur, 
            action: "desinscrire", 
            clubPassword: clubPassword,
            masterToken: isMaster ? masterToken : null 
        });
    }
}

function togglePresence(joueur) {
    if (!appData.inscriptions[activeTournoiId]) appData.inscriptions[activeTournoiId] = {};
    const tournoiInsc = appData.inscriptions[activeTournoiId];

    if (typeof tournoiInsc[joueur] === 'undefined') {
        tournoiInsc[joueur] = { present: true };
    }

    const currentPresent = tournoiInsc[joueur].present || false;
    const newPresent = !currentPresent;
    tournoiInsc[joueur].present = newPresent;
    lastLocalInscriptionTime = Date.now();
    updateInscritsUI();

    if (scriptUrl && activeTournoiId) {
        enqueuePostRequest({ tournoiId: activeTournoiId, joueur: joueur, action: "present", present: newPresent, masterToken: masterToken });
        if (tablesGenerees !== null && isMaster) {
            saveGameStateToSheet();
        }
    }
}
