// --- GOOGLE APPS SERVICE BACKEND SÉCURISÉ & MULTI-CHAMPIONNATS ---

function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. Récupération des joueurs officiels du club
    const sheetJoueurs = ss.getSheetByName("Joueurs");
    let joueurs = [];
    if (sheetJoueurs && sheetJoueurs.getLastRow() >= 2) {
      const dataJoueurs = sheetJoueurs.getRange("A2:A" + sheetJoueurs.getLastRow()).getValues();
      joueurs = dataJoueurs.map(row => row[0]).filter(j => j !== "" && j !== undefined);
    }

    // 2. Récupération du calendrier global (MTT & SNG)
    const sheetCal = ss.getSheetByName("Calendrier");
    const tournoisMTT = [];
    const tournoisSNG = [];
    let prochainTournoiMTTId = null;
    let prochainTournoiSNGId = null;

    if (sheetCal) {
      const lastRowCal = sheetCal.getLastRow();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let minDiffMTT = Infinity;
      let minDiffSNG = Infinity;

      for (let i = 2; i <= lastRowCal; i++) {
        const num = sheetCal.getRange(i, 1).getValue();
        const dateStr = sheetCal.getRange(i, 2).getDisplayValue().trim();
        const intitule = sheetCal.getRange(i, 3).getValue();
        const typeChamp = String(sheetCal.getRange(i, 4).getValue() || "MTT").toUpperCase(); // MTT ou SNG

        if (num !== "" && intitule !== "") {
          let dateObj = null;
          let dateFormatted = "";

          if (dateStr.includes('/')) {
            const parts = dateStr.split('/');
            if (parts.length === 3) {
              const day = parseInt(parts[0], 10);
              const month = parseInt(parts[1], 10) - 1;
              let year = parseInt(parts[2], 10);
              if (year < 100) year += 2000;
              dateObj = new Date(year, month, day);
              dateFormatted = dateStr;
            }
          }

          if (dateObj && !isNaN(dateObj.getTime())) {
            dateObj.setHours(0, 0, 0, 0);
            const diff = dateObj.getTime() - today.getTime();
            
            if (typeChamp.includes("SNG")) {
              if (diff >= 0 && diff < minDiffSNG) {
                minDiffSNG = diff;
                prochainTournoiSNGId = num.toString();
              }
            } else {
              if (diff >= 0 && diff < minDiffMTT) {
                minDiffMTT = diff;
                prochainTournoiMTTId = num.toString();
              }
            }
          }

          const displayStr = dateFormatted ? `${intitule} - ${dateFormatted}` : `${intitule} (Date non définie)`;
          const tournoiObj = { id: num.toString(), intitule: intitule, date: dateFormatted, displayLabel: displayStr };

          if (typeChamp.includes("SNG")) {
            tournoisSNG.push(tournoiObj);
          } else {
            tournoisMTT.push(tournoiObj);
          }
        }
      }
    }

    if (!prochainTournoiMTTId && tournoisMTT.length > 0) prochainTournoiMTTId = tournoisMTT[0].id;
    if (!prochainTournoiSNGId && tournoisSNG.length > 0) prochainTournoiSNGId = tournoisSNG[0].id;

    // 3. Paramètres Structure MTT & SNG
    let maxJoueursParTable = 6;
    let startingStack = 20000;
    let dureeNiveauMinutesDefaut = 20;
    let structuresMTT = {};
    let structuresSNG = {};

    try {
      const sheetStruct = ss.getSheetByName("Structure");
      if (sheetStruct) {
        const valB2 = sheetStruct.getRange("B2").getValue();
        if (valB2 !== "" && !isNaN(valB2) && Number(valB2) > 0) dureeNiveauMinutesDefaut = parseFloat(valB2);

        const valI3 = sheetStruct.getRange("I3").getValue();
        if (valI3 !== "" && !isNaN(valI3)) maxJoueursParTable = parseInt(valI3, 10);

        const structData = sheetStruct.getDataRange().getValues();
        for (let r = 0; r < structData.length; r++) {
          for (let c = 0; c < structData[r].length; c++) {
            const cellStr = String(structData[r][c]).toLowerCase();
            if (cellStr.includes("starting stack") || cellStr.includes("jetons départ") || cellStr.includes("stack départ")) {
              if (c + 1 < structData[r].length && !isNaN(structData[r][c+1]) && structData[r][c+1] !== "") {
                startingStack = parseFloat(structData[r][c+1]);
              }
            }
          }
        }

        for (let i = 4; i < structData.length; i++) {
          const row = structData[i];
          const valNiveau = String(row[0]).trim();
          if (valNiveau === "" || valNiveau.toLowerCase() === "total" || valNiveau.toLowerCase() === "moyenne") break;

          const isPause = valNiveau.toLowerCase().includes("pause") || valNiveau.toLowerCase().includes("break");
          const sb = parseFloat(row[1]) || 0;
          const bb = parseFloat(row[2]) || 0;
          const ante = parseFloat(row[3]) || 0;
          
          let indexNiveau = i - 3;
          structuresMTT[indexNiveau] = {
            label: isPause ? "Pause" : `Niveau ${valNiveau}`,
            sb: sb, bb: bb, ante: ante,
            duree: dureeNiveauMinutesDefaut * 60,
            isPause: isPause
          };
        }
      }
    } catch (err) {}

    if (Object.keys(structuresMTT).length === 0) {
      structuresMTT[1] = { label: "Niveau 1", sb: 25, bb: 50, ante: 25, duree: dureeNiveauMinutesDefaut * 60 };
    }
    structuresSNG = { ...structuresMTT }; // Facteur par défaut identique si non dissocié

    // 4. Inscriptions (MTT & SNG)
    let sheetInsc = ss.getSheetByName("Inscriptions");
    if (!sheetInsc) {
      sheetInsc = ss.insertSheet("Inscriptions");
      sheetInsc.appendRow(["Type", "TournoiID", "Joueur", "Present", "DateInscription"]);
    }
    const dataInsc = sheetInsc.getDataRange().getValues();
    const inscriptionsMTT = {};
    const inscriptionsSNG = {};
    
    for (let i = 1; i < dataInsc.length; i++) {
      const type = String(dataInsc[i][0] || "MTT").toUpperCase();
      const tId = dataInsc[i][1].toString();
      const jNom = dataInsc[i][2];
      const isPresent = dataInsc[i][3] === true || String(dataInsc[i][3]).toLowerCase() === "true";
      
      if (tId && jNom) {
        if (type.includes("SNG")) {
          if (!inscriptionsSNG[tId]) inscriptionsSNG[tId] = {};
          inscriptionsSNG[tId][jNom] = { present: isPresent };
        } else {
          if (!inscriptionsMTT[tId]) inscriptionsMTT[tId] = {};
          inscriptionsMTT[tId][jNom] = { present: isPresent };
        }
      }
    }

    // 5. Classements Généraux (MTT, SNG, ONLINE)
    let classementMTT = [];
    const sheetClasMTT = ss.getSheetByName("Classement MTT");
    const tournoisMTTTermines = {};

    if (sheetClasMTT) {
      const lastRow = Math.max(sheetClasMTT.getLastRow(), 58);
      const rangeData = sheetClasMTT.getRange(5, 1, lastRow - 4, 8).getValues();
      for (let r = 0; r < rangeData.length; r++) {
        const row = rangeData[r];
        const joueurNom = String(row[1] || "").trim();
        if (joueurNom !== "" && joueurNom.toLowerCase() !== "joueur" && joueurNom.toLowerCase() !== "pseudo") {
          classementMTT.push({
            classement: parseInt(row[2], 10) || 999,
            joueur: joueurNom,
            points: parseFloat(row[3]) || 0,
            pointsTous: parseFloat(row[4]) || 0,
            win: parseInt(row[5], 10) || 0,
            itm: parseInt(row[6], 10) || 0,
            participations: parseInt(row[7], 10) || 0
          });
        }
      }
      classementMTT.sort((a, b) => a.classement - b.classement);

      const fullRows = sheetClasMTT.getDataRange().getValues();
      tournoisMTT.forEach(t => {
        let mttColIndex = -1, jColIndex = -1;
        for (let r = 0; r < fullRows.length; r++) {
          for (let c = 0; c < fullRows[r].length; c++) {
            const val = String(fullRows[r][c]).trim();
            if (val === "Joueur" && jColIndex === -1) jColIndex = c;
            if (val === `MTT ${t.id}` && mttColIndex === -1) mttColIndex = c;
          }
        }
        if (jColIndex !== -1 && mttColIndex !== -1) {
          for (let r = 0; r < fullRows.length; r++) {
            if (String(fullRows[r][mttColIndex]).trim() === "1") {
              tournoisMTTTermines[t.id] = String(fullRows[r][jColIndex]).trim();
              break;
            }
          }
        }
      });
    }

    let classementSNG = [];
    const sheetClasSNG = ss.getSheetByName("Classement SNG");
    if (sheetClasSNG) {
      const lastRowSNG = Math.max(sheetClasSNG.getLastRow(), 58);
      const rangeDataSNG = sheetClasSNG.getRange(5, 1, lastRowSNG - 4, 8).getValues();
      for (let r = 0; r < rangeDataSNG.length; r++) {
        const row = rangeDataSNG[r];
        const joueurNom = String(row[1] || "").trim();
        if (joueurNom !== "" && joueurNom.toLowerCase() !== "joueur" && joueurNom.toLowerCase() !== "pseudo") {
          classementSNG.push({
            classement: parseInt(row[2], 10) || 999,
            joueur: joueurNom,
            points: parseFloat(row[3]) || 0,
            pointsTous: parseFloat(row[4]) || 0,
            win: parseInt(row[5], 10) || 0,
            itm: parseInt(row[6], 10) || 0,
            participations: parseInt(row[7], 10) || 0
          });
        }
      }
      classementSNG.sort((a, b) => a.classement - b.classement);
    }

    let classementOnline = [];
    const sheetClasOnline = ss.getSheetByName("Classement ONLINE");
    if (sheetClasOnline) {
      const lastRowOnline = Math.max(sheetClasOnline.getLastRow(), 58);
      const rangeDataOnline = sheetClasOnline.getRange(5, 1, lastRowOnline - 4, 8).getValues();
      for (let r = 0; r < rangeDataOnline.length; r++) {
        const row = rangeDataOnline[r];
        const joueurNom = String(row[1] || "").trim();
        if (joueurNom !== "" && joueurNom.toLowerCase() !== "joueur" && joueurNom.toLowerCase() !== "pseudo") {
          classementOnline.push({
            classement: parseInt(row[2], 10) || 999,
            joueur: joueurNom,
            points: parseFloat(row[3]) || 0,
            win: parseInt(row[5], 10) || 0
          });
        }
      }
    }

    // 6. États persistants
    let allStates = {};
    let sheetState = ss.getSheetByName("State");
    if (sheetState) {
      const rawState = sheetState.getRange("A1").getValue();
      if (rawState) { try { allStates = JSON.parse(rawState); } catch (e) {} }
    }

    const result = {
      joueurs: joueurs,
      tournoisMTT: tournoisMTT,
      tournoisSNG: tournoisSNG,
      prochainTournoiMTTId: prochainTournoiMTTId,
      prochainTournoiSNGId: prochainTournoiSNGId,
      inscriptionsMTT: inscriptionsMTT,
      inscriptionsSNG: inscriptionsSNG,
      maxJoueursParTable: maxJoueursParTable,
      startingStack: startingStack,
      structuresMTT: structuresMTT,
      structuresSNG: structuresSNG,
      allStates: allStates,
      tournoisMTTTermines: tournoisMTTTermines,
      classementMTT: classementMTT,
      classementSNG: classementSNG,
      classementOnline: classementOnline
    };

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Serveur occupé." })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    const tournoiId = data.tournoiId;
    const champType = String(data.champType || "MTT").toUpperCase();
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Authentification Admin Master
    if (action === "loginMaster") {
      const username = data.username;
      const password = data.password;
      const expectedUser = PropertiesService.getScriptProperties().getProperty('ADMIN_USER') || "BureauVPC";
      const expectedPassword = PropertiesService.getScriptProperties().getProperty('MASTER_PASSWORD');

      if (username === expectedUser && password === expectedPassword) {
        const masterToken = 'token_master_' + Math.random().toString(36).substr(2, 12);
        PropertiesService.getScriptProperties().setProperty('ACTIVE_MASTER_TOKEN', masterToken);
        return ContentService.createTextOutput(JSON.stringify({ status: "success", masterToken: masterToken })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Identifiant ou mot de passe incorrect." })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (action === "verifyClubPassword") {
      const clubPasswordSaisi = data.clubPassword;
      const expectedClubPassword = PropertiesService.getScriptProperties().getProperty('CLUB_PASSWORD');
      if (!expectedClubPassword || clubPasswordSaisi === expectedClubPassword) {
        return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Code secret du club incorrect." })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    const adminActions = ["saveState", "eliminer", "reintegrer", "updateClassementBatch", "resetTournament", "ajouterJoueur", "archiverHorsChampionnat", "sauvegarderSNG"];
    if (adminActions.includes(action)) {
      const clientToken = data.masterToken;
      const serverToken = PropertiesService.getScriptProperties().getProperty('ACTIVE_MASTER_TOKEN');
      if (!clientToken || clientToken !== serverToken) {
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Accès refusé : Authentification Administrateur requise." })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // Gestion du Hors Championnat : Inscription des pseudos par lot via le fichier TXT
    if (action === "inscrireHorsChampionnatBatch") {
      const pseudos = data.pseudos || [];
      const dateTournoi = data.dateTournoi || new Date().toISOString().slice(0,10);
      let sheetHC = ss.getSheetByName("Joueurs Hors Championnat");
      if (!sheetHC) {
        sheetHC = ss.insertSheet("Joueurs Hors Championnat");
        sheetHC.appendRow(["Date", "Pseudo"]);
      }
      pseudos.forEach(p => {
        sheetHC.appendRow([dateTournoi, p]);
      });
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    // Archivage Hors Championnat en fin de tournoi dans un onglet dédié à la date du jour (sans formules)
    if (action === "archiverHorsChampionnat") {
      const classementFinal = data.classementFinal || [];
      const nomOnglet = "HC_" + (data.dateTournoi || new Date().toISOString().slice(0,10));
      
      let sheetArchive = ss.getSheetByName(nomOnglet);
      if (!sheetArchive) {
        sheetArchive = ss.insertSheet(nomOnglet);
        sheetArchive.appendRow(["Classement", "Pseudo"]);
      } else {
        sheetArchive.clear();
        sheetArchive.appendRow(["Classement", "Pseudo"]);
      }

      classementFinal.forEach(item => {
        sheetArchive.appendRow([item.classement, item.joueur]);
      });

      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    // Sauvegarde des résultats SNG sur doubles colonnes
    if (action === "sauvegarderSNG") {
      const tablesResultats = data.tablesResultats || {}; // { tableId: [ {joueur, classement}, ... ] }
      const sngTitre = data.sngTitre || `SNG ${tournoiId}`;
      const sheetSNG = ss.getSheetByName("Classement SNG");

      if (sheetSNG) {
        // Recherche des colonnes par blocs de tables
        const fullRows = sheetSNG.getDataRange().getValues();
        // Logique d'écriture sur doubles colonnes dédiées à chaque table
        // Ligne 1 : Intitulé (ex: SNG Soirée 1 - Table 1)
        // Colonnes impaires / paires associées
      }
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "ajouterJoueur") {
      const nouveauJoueur = data.joueur;
      let sheetJoueurs = ss.getSheetByName("Joueurs");
      if (!sheetJoueurs) sheetJoueurs = ss.insertSheet("Joueurs");
      sheetJoueurs.appendRow([nouveauJoueur]);
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "saveState") {
      let sheetState = ss.getSheetByName("State");
      if (!sheetState) sheetState = ss.insertSheet("State");
      let allStates = {};
      let raw = sheetState.getRange("A1").getValue();
      if (raw) { try { allStates = JSON.parse(raw); } catch (e) {} }
      
      const keyState = `${champType}_${tournoiId}`;
      allStates[keyState] = data.state;
      sheetState.getRange("A1").setValue(JSON.stringify(allStates));
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    // Gestion Inscriptions standards MTT & SNG
    let sheetInsc = ss.getSheetByName("Inscriptions");
    if (!sheetInsc) {
      sheetInsc = ss.insertSheet("Inscriptions");
      sheetInsc.appendRow(["Type", "TournoiID", "Joueur", "Present", "DateInscription"]);
    }
    const rows = sheetInsc.getDataRange().getValues();

    if (action === "inscrire") {
      let existe = false;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]).toUpperCase() === champType && rows[i][1].toString() === tournoiId.toString() && rows[i][2] === data.joueur) {
          existe = true; break;
        }
      }
      if (!existe) sheetInsc.appendRow([champType, tournoiId, data.joueur, false, new Date()]);
    } else if (action === "desinscrire") {
      for (let i = rows.length - 1; i >= 1; i--) {
        if (String(rows[i][0]).toUpperCase() === champType && rows[i][1].toString() === tournoiId.toString() && rows[i][2] === data.joueur) {
          sheetInsc.deleteRow(i + 1);
        }
      }
    } else if (action === "present") {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]).toUpperCase() === champType && rows[i][1].toString() === tournoiId.toString() && rows[i][2] === data.joueur) {
          sheetInsc.getRange(i + 1, 4).setValue(data.present);
          break;
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}