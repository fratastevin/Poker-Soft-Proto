function getDefaultTableMeta(tNum) {
    const idx = Math.max(0, (parseInt(tNum, 10) || 1) - 1);
    const paletteItem = PALETTE_COULEURS_CLUB[idx % PALETTE_COULEURS_CLUB.length];
    return {
        name: `Table ${paletteItem.label}`,
        color: paletteItem.hex
    };
}

function ensureTablesMeta() {
    if (!tablesMeta || typeof tablesMeta !== 'object') tablesMeta = {};
    if (tablesGenerees) {
        Object.keys(tablesGenerees).forEach(tId => {
            if (!tablesMeta[tId]) {
                tablesMeta[tId] = getDefaultTableMeta(tId);
            } else {
                if (!tablesMeta[tId].name) tablesMeta[tId].name = `Table ${tId}`;
                if (!tablesMeta[tId].color) tablesMeta[tId].color = getDefaultTableMeta(tId).color;
            }
        });
    }
}

function getTableDisplayName(tId) {
    ensureTablesMeta();
    return (tablesMeta[tId] && tablesMeta[tId].name) ? tablesMeta[tId].name : `Table ${tId}`;
}

function getTableColor(tId) {
    ensureTablesMeta();
    return (tablesMeta[tId] && tablesMeta[tId].color) ? tablesMeta[tId].color : getDefaultTableMeta(tId).color;
}

function updateTableName(tId, newName) {
    if (!checkMastershipBeforeAction()) {
        renderTablesUI();
        return;
    }
    ensureTablesMeta();
    const trimmed = (newName || '').trim();
    tablesMeta[tId].name = trimmed || `Table ${tId}`;
    renderTablesUI();
    saveGameStateToSheet();
}

function updateTableColor(tId, newColor, presetLabel) {
    if (!checkMastershipBeforeAction()) {
        renderTablesUI();
        return;
    }
    ensureTablesMeta();
    tablesMeta[tId].color = newColor;
    if (presetLabel) {
        const currentName = tablesMeta[tId].name || '';
        if (!currentName || /^Table(\s|$)/i.test(currentName)) {
            tablesMeta[tId].name = `Table ${presetLabel}`;
        }
    }
    renderTablesUI();
    saveGameStateToSheet();
}

function repartirTablesRecalculees(listeJoueurs) {
    const tour = getActiveTournoi();
    const maxPerTable = (tour && tour.type === 'SNG') ? (appData.maxJoueursParTableSNG || appData.maxJoueursParTable || 6) : (appData.maxJoueursParTable || 6);
    const finalTableSize = getFinalTableSize(maxPerTable);
    listeJoueurs.sort(() => Math.random() - 0.5);

    const nbTables = (listeJoueurs.length <= finalTableSize) ? 1 : Math.ceil(listeJoueurs.length / maxPerTable);
    const seatsPerTable = (nbTables === 1 && listeJoueurs.length > maxPerTable) ? finalTableSize : maxPerTable;

    let tables = {};
    tablesMeta = {};
    for (let t = 1; t <= nbTables; t++) {
        tables[t] = [];
        tablesMeta[t] = getDefaultTableMeta(t);
        for (let s = 1; s <= seatsPerTable; s++) {
            tables[t].push({ seat: s, player: null });
        }
    }

    let tIdx = 1, sIdx = 0;
    listeJoueurs.forEach(j => {
        while (tables[tIdx][sIdx].player !== null) {
            tIdx++;
            if (tIdx > nbTables) { tIdx = 1; sIdx++; }
        }
        tables[tIdx][sIdx].player = j;
        tIdx++;
        if (tIdx > nbTables) { tIdx = 1; sIdx++; }
    });

    for (const tId of Object.keys(tables)) {
        let joueursTable = tables[tId].map(s => s.player).filter(p => p !== null);
        joueursTable.sort(() => Math.random() - 0.5);
        tables[tId].forEach((s, idx) => {
            s.player = joueursTable[idx] !== undefined ? joueursTable[idx] : null;
        });
    }

    tablesGenerees = tables;
    renderTablesUI();
}

function genererTables() {
    if (!checkMastershipBeforeAction()) return;
    if (tablesGenerees !== null) return;
    const tournoiInsc = appData.inscriptions[activeTournoiId] || {};
    let inscritsNoms = Array.isArray(tournoiInsc) ? tournoiInsc : Object.keys(tournoiInsc);
    const tour = getActiveTournoi();
    const isSNG = (tour && tour.type === 'SNG');
    const maxPerTable = isSNG ? (appData.maxJoueursParTableSNG || appData.maxJoueursParTable || 6) : (appData.maxJoueursParTable || 6);
    const finalTableSize = isSNG ? maxPerTable : getFinalTableSize(maxPerTable);

    if (inscritsNoms.length === 0) {
        alert("Aucun joueur inscrit !");
        return;
    }

    let presents = inscritsNoms.filter(j => (tournoiInsc[j] && tournoiInsc[j].present));
    let absents = inscritsNoms.filter(j => !(tournoiInsc[j] && tournoiInsc[j].present));
    
    presents.sort(() => Math.random() - 0.5);
    absents.sort(() => Math.random() - 0.5);

    const totalJoueurs = inscritsNoms.length;
    totalJoueursInitial = totalJoueurs;

    const isDirectFinalTable = (!isSNG && totalJoueurs <= finalTableSize && totalJoueurs > maxPerTable);
    const nbTables = isDirectFinalTable ? 1 : Math.ceil(totalJoueurs / maxPerTable);
    const seatsCount = isDirectFinalTable ? finalTableSize : maxPerTable;

    let tables = {};
    tablesMeta = {};
    for (let t = 1; t <= nbTables; t++) {
        tables[t] = [];
        tablesMeta[t] = getDefaultTableMeta(t);
        for (let s = 1; s <= seatsCount; s++) {
            tables[t].push({ seat: s, player: null });
        }
    }

    let currentTable = 1;
    let currentSeatOffset = 0;

    presents.forEach(p => {
        while (tables[currentTable][currentSeatOffset].player !== null) {
            currentTable++;
            if (currentTable > nbTables) {
                currentTable = 1;
                currentSeatOffset++;
            }
        }
        tables[currentTable][currentSeatOffset].player = p;
        currentTable++;
        if (currentTable > nbTables) {
            currentTable = 1;
            currentSeatOffset++;
        }
    });

    absents.forEach(a => {
        let placed = false;
        for (let s = 0; s < seatsCount && !placed; s++) {
            for (let t = 1; t <= nbTables && !placed; t++) {
                if (tables[t][s].player === null) {
                    tables[t][s].player = a;
                    placed = true;
                }
            }
        }
    });

    for (const tId of Object.keys(tables)) {
        let joueursTable = tables[tId].map(s => s.player).filter(p => p !== null);
        joueursTable.sort(() => Math.random() - 0.5);
        tables[tId].forEach((s, idx) => {
            s.player = joueursTable[idx] !== undefined ? joueursTable[idx] : null;
        });
    }

    tablesGenerees = tables;
    joueursEliminesHistorique = [];
    liveActionHistory = [];
    addLiveHistoryEntry('info', `🎲 Tables générées (${nbTables} table(s) pour ${totalJoueurs} joueur(s))`);
    renderTablesUI();
    document.getElementById('table-status-msg').innerText = isDirectFinalTable 
        ? `Table Finale directe générée (${totalJoueurs} joueurs réunis sur 1 table de ${seatsCount}).`
        : `Tables générées avec succès (${nbTables} tables réparties pour ${totalJoueurs} inscrits).`;
    checkTournoiLockStatus();
    saveGameStateToSheet();
}

function renderTablesUI() {
    const container = document.getElementById('poker-tables-container');
    container.innerHTML = '';

    if (!tablesGenerees) {
        container.innerHTML = `<p style="color:#94a3b8; font-style:italic;">Aucune table générée pour le moment.</p>`;
        return;
    }

    ensureTablesMeta();

    for (const [tNum, seats] of Object.entries(tablesGenerees)) {
        const actifsCount = seats.filter(s => s.player !== null).length;
        const tableName = getTableDisplayName(tNum);
        const tableColor = getTableColor(tNum);
        const safeTableName = tableName.replace(/"/g, '&quot;');

        let seatsHtml = '';
        seats.forEach(s => {
            const playerDisplay = s.player ? `<span class="seat-player">${s.player}</span>` : `<span class="seat-empty">Siège vide</span>`;
            const safePlayer = s.player ? s.player.replace(/'/g, "\\'") : '';
            const draggableAttr = (s.player && isMaster) ? `draggable="true" ondragstart="onDragStart(event, '${tNum}', '${s.seat}', '${safePlayer}')"` : '';
            
            seatsHtml += `
                <div class="seat-item" ${draggableAttr} ondragover="onDragOver(event)" ondragleave="onDragLeave(event)" ondrop="onDrop(event, '${tNum}', '${s.seat}')">
                    <span class="seat-num">Siège ${s.seat}</span>
                    ${playerDisplay}
                </div>
            `;
        });

        let customizerHtml = '';
        if (isMaster) {
            const swatchesHtml = PALETTE_COULEURS_CLUB.map(c => {
                const isActive = (c.hex.toLowerCase() === tableColor.toLowerCase()) ? 'active' : '';
                const safeLabel = c.label.replace(/'/g, "\\'");
                return `<button type="button" class="swatch-btn ${isActive}" style="background:${c.hex};" title="${c.label}" onclick="updateTableColor('${tNum}', '${c.hex}', '${safeLabel}')"></button>`;
            }).join('');

            customizerHtml = `
                <div class="table-customizer">
                    <input type="text" class="table-name-input" value="${safeTableName}" placeholder="Nom de la table..." onchange="updateTableName('${tNum}', this.value)">
                    <div class="color-swatches">
                        ${swatchesHtml}
                        <input type="color" class="color-picker-input" value="${tableColor}" title="Couleur personnalisée" onchange="updateTableColor('${tNum}', this.value, null)">
                    </div>
                </div>
            `;
        }

        container.innerHTML += `
            <div class="poker-table-card" style="border-left-color:${tableColor};">
                <div class="poker-table-title">
                    <span style="display:flex; align-items:center; gap:0.4rem;">
                        <span class="table-color-dot" style="background:${tableColor};"></span>
                        <span>${tableName}</span>
                    </span>
                    <span style="font-size:0.75rem; color:#94a3b8;">(${actifsCount} joueurs)</span>
                </div>
                ${customizerHtml}
                <div class="seat-list">${seatsHtml}</div>
            </div>
        `;
    }
}

let draggedData = null;
function onDragStart(event, tableNum, seatNum, playerName) {
    if (!isMaster) return;
    draggedData = { tableNum, seatNum, playerName };
    event.dataTransfer.setData('text/plain', playerName);
}

function onDragOver(event) { if (!isMaster) return; event.preventDefault(); event.currentTarget.classList.add('drag-over'); }
function onDragLeave(event) { event.currentTarget.classList.remove('drag-over'); }

function onDrop(event, targetTableNum, targetSeatNum) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    if (!draggedData || !checkMastershipBeforeAction()) return;

    const srcTable = draggedData.tableNum;
    const srcSeat = draggedData.seatNum;
    const movingPlayer = draggedData.playerName;

    const targetSeatObj = tablesGenerees[targetTableNum].find(s => s.seat == targetSeatNum);
    const targetPlayer = targetSeatObj.player;

    tablesGenerees[srcTable].find(s => s.seat == srcSeat).player = targetPlayer;
    targetSeatObj.player = movingPlayer;

    draggedData = null;
    const dstName = getTableDisplayName(targetTableNum);
    const srcName = getTableDisplayName(srcTable);
    if (targetPlayer) {
        addLiveHistoryEntry('move', `🔄 Échange manuel : <b>${movingPlayer}</b> (${srcName} S.${srcSeat}) ↔ <b>${targetPlayer}</b> (${dstName} S.${targetSeatNum})`);
    } else {
        addLiveHistoryEntry('move', `🔄 Déplacement manuel : <b>${movingPlayer}</b> (${srcName} S.${srcSeat} ➔ ${dstName} S.${targetSeatNum})`);
    }
    renderTablesUI();
    verifierEtReequilibrer();
    saveGameStateToSheet();
}
