function renderClassementUI() {
    const container = document.getElementById('classement-container');
    container.innerHTML = '';

    const tour = getActiveTournoi();
    const isSNG = (tour && tour.type === 'SNG');

    if (isSNG) {
        if (!tablesGenerees && joueursEliminesHistorique.length === 0) {
            container.innerHTML = `<p style="color:#94a3b8; font-style:italic;">Aucune table générée pour ce SNG.</p>`;
            return;
        }

        let tablesIds = new Set();
        if (tablesGenerees) {
            Object.keys(tablesGenerees).forEach(id => tablesIds.add(String(id)));
        }
        joueursEliminesHistorique.forEach(item => {
            if (item.origTableId) tablesIds.add(String(item.origTableId));
        });

        let html = `<p style="font-size:0.75rem; color:#94a3b8; margin-bottom:1rem;">Classement par table. Glissez-déposez un joueur uniquement au sein de <b>sa propre table</b> pour ajuster son rang.</p>`;

        Array.from(tablesIds).sort((a,b) => Number(a) - Number(b)).forEach(tNum => {
            let eliminesTable = joueursEliminesHistorique.filter(item => String(item.origTableId) === String(tNum));
            eliminesTable.sort((a, b) => a.classement - b.classement);
            const tColor = getTableColor(tNum);

            html += `<div class="card" style="margin-bottom:1rem; border-left: 4px solid ${tColor};">
                <h3 style="margin-top:0; color:#fbbf24; font-size:1.05rem;">${getTableDisplayName(tNum)} - Classement</h3>`;
            
            if (eliminesTable.length === 0) {
                html += `<p style="color:#94a3b8; font-style:italic; font-size:0.875rem;">Aucun joueur classé sur cette table pour le moment.</p>`;
            } else {
                html += `<div style="margin-top:0.5rem;">`;
                eliminesTable.forEach(item => {
                    const safePlayer = item.joueur.replace(/'/g, "\\'");
                    const draggableAttr = isMaster
                        ? `draggable="true" ondragstart="onDragClassementStart(event, '${safePlayer}')" ondragend="onDragClassementEnd()" ondragover="onDragOver(event)" ondragleave="onDragLeave(event)" ondrop="onDropClassement(event, '${safePlayer}')"`
                        : '';
                    const rankBadge = item.classement === 1 ? `🏆 #1` : `#${item.classement}`;
                    html += `
                        <div class="classement-item ${isMaster ? '' : 'no-drag'}" ${draggableAttr}>
                            <span style="font-weight:bold; color:#fbbf24; width:55px;">${rankBadge}</span>
                            <span style="flex-grow:1; font-weight:500;">${item.joueur}</span>
                            <span style="font-size:0.75rem; color:#94a3b8;">${isMaster ? 'Glisser (même table)' : ''}</span>
                        </div>
                    `;
                });
                html += `</div>`;
            }
            html += `</div>`;
        });
        container.innerHTML = html;
        return;
    }

    const uniquesMap = new Map();
    joueursEliminesHistorique.forEach(item => {
        if (!uniquesMap.has(item.joueur)) {
            uniquesMap.set(item.joueur, item);
        }
    });
    let eliminesTries = Array.from(uniquesMap.values()).sort((a, b) => a.classement - b.classement);

    if (eliminesTries.length === 0) {
        container.innerHTML = `<p style="color:#94a3b8; font-style:italic;">Aucun joueur éliminé pour le moment.</p>`;
        return;
    }

    let mttHtml = `<p style="font-size:0.75rem; color:#94a3b8; margin-bottom:1rem;">Classés du mieux placé au moins bien placé. Glissez-déposez pour réajuster l'ordre si besoin.</p>`;
    eliminesTries.forEach((item) => {
        const safePlayer = item.joueur.replace(/'/g, "\\'");
        const draggableAttr = isMaster
            ? `draggable="true" ondragstart="onDragClassementStart(event, '${safePlayer}')" ondragend="onDragClassementEnd()" ondragover="onDragOver(event)" ondragleave="onDragLeave(event)" ondrop="onDropClassement(event, '${safePlayer}')"`
            : '';
        const rankBadge = item.classement === 1 ? `🏆 #1` : `#${item.classement}`;
        mttHtml += `
            <div class="classement-item ${isMaster ? '' : 'no-drag'}" ${draggableAttr}>
                <span style="font-weight:bold; color:#fbbf24; width:55px;">${rankBadge}</span>
                <span style="flex-grow:1; font-weight:500;">${item.joueur}</span>
                <span style="font-size:0.75rem; color:#94a3b8;">${isMaster ? 'Glisser pour réordonner' : ''}</span>
            </div>
        `;
    });
    container.innerHTML = mttHtml;
}

function onDragClassementStart(event, playerName) {
    if (!isMaster) return;
    isDraggingClassement = true;
    draggedPlayerName = playerName;
    event.dataTransfer.setData('text/plain', playerName);
}

function onDragClassementEnd() {
    isDraggingClassement = false;
    draggedPlayerName = null;
}

function onDropClassement(event, targetPlayerName) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    isDraggingClassement = false;

    if (!draggedPlayerName || draggedPlayerName === targetPlayerName || !checkMastershipBeforeAction()) {
        draggedPlayerName = null;
        return;
    }

    const tour = getActiveTournoi();
    const isSNG = (tour && tour.type === 'SNG');

    const uniquesMap = new Map();
    joueursEliminesHistorique.forEach(item => {
        if (!uniquesMap.has(item.joueur)) {
            uniquesMap.set(item.joueur, { ...item });
        }
    });
    const allItems = Array.from(uniquesMap.values());

    const srcItem = allItems.find(i => i.joueur === draggedPlayerName);
    const dstItem = allItems.find(i => i.joueur === targetPlayerName);
    draggedPlayerName = null;

    if (!srcItem || !dstItem) return;

    if (isSNG) {
        // Interdiction formelle de drag & drop vers une autre table en SNG
        if (String(srcItem.origTableId) !== String(dstItem.origTableId)) {
            alert("❌ En mode SNG, le glisser-déposer n'est autorisé qu'à l'intérieur de la même table.");
            return;
        }

        const tableId = String(srcItem.origTableId);
        let tableList = allItems
            .filter(i => String(i.origTableId) === tableId)
            .sort((a, b) => a.classement - b.classement);

        const fromIdx = tableList.findIndex(i => i.joueur === srcItem.joueur);
        const toIdx = tableList.findIndex(i => i.joueur === dstItem.joueur);
        if (fromIdx === -1 || toIdx === -1) return;

        const [moved] = tableList.splice(fromIdx, 1);
        tableList.splice(toIdx, 0, moved);

        tableList.forEach((item, idx) => {
            item.classement = idx + 1;
        });

        const otherItems = allItems.filter(i => String(i.origTableId) !== tableId);
        joueursEliminesHistorique = [...otherItems, ...tableList];

        renderClassementUI();
        saveGameStateToSheet();

        if (scriptUrl && activeTournoiId) {
            const classementMap = {};
            tableList.forEach(item => { classementMap[item.joueur] = item.classement; });
            enqueuePostRequest({
                tournoiId: activeTournoiId,
                action: "updateClassementBatch",
                masterToken: masterToken,
                tableNum: tableId,
                classementMap: classementMap
            });
            setTimeout(() => loadDataFromSheet(), 1500);
        }
        return;
    }

    // Mode MTT
    let eliminesTries = allItems.sort((a, b) => a.classement - b.classement);
    const fromIndex = eliminesTries.findIndex(i => i.joueur === srcItem.joueur);
    const toIndex = eliminesTries.findIndex(i => i.joueur === dstItem.joueur);
    if (fromIndex === -1 || toIndex === -1) return;

    const [movedItem] = eliminesTries.splice(fromIndex, 1);
    eliminesTries.splice(toIndex, 0, movedItem);

    let actifsRestants = 0;
    if (tablesGenerees) {
        for (const seats of Object.values(tablesGenerees)) {
            actifsRestants += seats.filter(s => s.player !== null).length;
        }
    }
    const rangDepart = actifsRestants + 1;

    eliminesTries.forEach((item, idx) => {
        item.classement = rangDepart + idx;
    });

    joueursEliminesHistorique = eliminesTries;
    renderClassementUI();
    saveGameStateToSheet();

    let classementMap = {};
    joueursEliminesHistorique.forEach(item => {
        classementMap[item.joueur] = item.classement;
    });

    if (scriptUrl && activeTournoiId) {
        enqueuePostRequest({
            tournoiId: activeTournoiId,
            action: "updateClassementBatch",
            masterToken: masterToken,
            classementMap: classementMap
        });
        setTimeout(() => loadDataFromSheet(), 1500);
    }
}

function renderClassementGeneralMTTUI() {
    const container = document.getElementById('general-container-mtt');
    const data = appData.classementGeneralMTT || [];

    if (data.length === 0) {
        container.innerHTML = `<p style="color:#94a3b8; font-style:italic;">Aucune donnée de classement général MTT disponible.</p>`;
        return;
    }

    let html = `
        <table class="table-general">
            <thead>
                <tr>
                    <th style="width:60px;">Place</th>
                    <th>Pseudo</th>
                    <th style="text-align:center;">Points</th>
                    <th style="text-align:center;">Points Tous</th>
                    <th style="text-align:center;">Win</th>
                    <th style="text-align:center;">ITM</th>
                    <th style="text-align:center;">Participations</th>
                </tr>
            </thead>
            <tbody>
    `;

    data.forEach((row) => {
        html += `
            <tr>
                <td style="font-weight:bold; color:#fbbf24;">#${row.classement}</td>
                <td style="font-weight:500;">${row.joueur}</td>
                <td style="text-align:center; font-weight:bold; color:#34d399;">${row.points}</td>
                <td style="text-align:center; font-weight:bold; color:#60a5fa;">${row.pointsTous}</td>
                <td style="text-align:center;">${row.win}</td>
                <td style="text-align:center;">${row.itm}</td>
                <td style="text-align:center;">${row.participations}</td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
}

function renderClassementGeneralSNGUI() {
    const container = document.getElementById('general-container-sng');
    const data = appData.classementGeneralSNG || [];

    if (data.length === 0) {
        container.innerHTML = `<p style="color:#94a3b8; font-style:italic;">Aucune donnée de classement général SNG disponible.</p>`;
        return;
    }

    let html = `
        <table class="table-general">
            <thead>
                <tr>
                    <th style="width:60px;">Place</th>
                    <th>Pseudo</th>
                    <th style="text-align:center;">Points</th>
                    <th style="text-align:center;">Points Tous</th>
                    <th style="text-align:center;">Win</th>
                    <th style="text-align:center;">ITM</th>
                    <th style="text-align:center;">Participations</th>
                </tr>
            </thead>
            <tbody>
    `;

    data.forEach((row) => {
        html += `
            <tr>
                <td style="font-weight:bold; color:#fbbf24;">#${row.classement}</td>
                <td style="font-weight:500;">${row.joueur}</td>
                <td style="text-align:center; font-weight:bold; color:#34d399;">${row.points}</td>
                <td style="text-align:center; font-weight:bold; color:#60a5fa;">${row.pointsTous}</td>
                <td style="text-align:center;">${row.win}</td>
                <td style="text-align:center;">${row.itm}</td>
                <td style="text-align:center;">${row.participations}</td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
}
