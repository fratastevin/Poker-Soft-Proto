// --- GOOGLE APPS SCRIPT BACKEND (AVEC LECTURE DYNAMIQUE STRUCTURE CASE B2 & SÉCURITÉ MAÎTRE) ---

function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. Récupération des joueurs
    const sheetJoueurs = ss.getSheetByName("Joueurs");
    const dataJoueurs = sheetJoueurs.getRange("A2:A" + sheetJoueurs.getLastRow()).getValues();
    const joueurs = dataJoueurs.map(row => row[0]).filter(j => j !== "" && j !== undefined);

    // 2. Récupération du calendrier
    const sheetCal = ss.getSheetByName("Calendrier");
    const lastRowCal = sheetCal.getLastRow();
    const tournois = [];
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let prochainTournoiId = null;
    let minDiff = Infinity;

    for (let i = 2; i <= lastRowCal; i++) {
      const num = sheetCal.getRange(i, 1).getValue();
      const dateStr = sheetCal.getRange(i, 2).getDisplayValue().trim();
      const intitule = sheetCal.getRange(i, 3).getValue();

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
          
          if (diff >= 0 && diff < minDiff) {
            minDiff = diff;
            prochainTournoiId = num.toString();
          }
        }

        const displayStr = dateFormatted ? `${intitule} - ${dateFormatted}` : `${intitule} (Date non définie)`;

        tournois.push({
          id: num.toString(),
          intitule: intitule,
          date: dateFormatted,
          displayLabel: displayStr
        });
      }
    }

    if (!prochainTournoiId && tournois.length > 0) {
      prochainTournoiId = tournois[0].id;
    }

    // 3. Paramètres Structure (Max joueurs I3, Starting Stack, Durée B2 & Blinds depuis l'onglet Structure)
    let maxJoueursParTable = 6;
    let startingStack = 20000;
    let dureeNiveauMinutesDefaut = 20;
    let structuresDynamiques = {};

    try {
      const sheetStruct = ss.getSheetByName("Structure");
      
      // Récupération de la durée globale des niveaux dans la case B2
      const valB2 = sheetStruct.getRange("B2").getValue();
      if (valB2 !== "" && !isNaN(valB2) && Number(valB2) > 0) {
        dureeNiveauMinutesDefaut = parseFloat(valB2);
      }

      const valI3 = sheetStruct.getRange("I3").getValue();
      if (valI3 !== "" && !isNaN(valI3)) {
        maxJoueursParTable = parseInt(valI3, 10);
      }

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

      // Lecture dynamique des niveaux à partir de la ligne 5 (Index 4)
      for (let i = 4; i < structData.length; i++) {
        const row = structData[i];
        const valNiveau = String(row[0]).trim();
        if (valNiveau === "" || valNiveau.toLowerCase() === "total" || valNiveau.toLowerCase() === "moyenne") break;

        const isPause = valNiveau.toLowerCase().includes("pause") || valNiveau.toLowerCase().includes("break");
        const sb = parseFloat(row[1]) || 0;
        const bb = parseFloat(row[2]) || 0;
        const ante = parseFloat(row[3]) || 0;
        
        let indexNiveau = i - 3; // Niveau 1, 2, 3...
        structuresDynamiques[indexNiveau] = {
          label: isPause ? "Pause" : `Niveau ${valNiveau}`,
          sb: sb,
          bb: bb,
          ante: ante,
          duree: dureeNiveauMinutesDefaut * 60, // En secondes (basé sur la case B2)
          isPause: isPause
        };
      }
    } catch (err) {}

    // Fallback si structure vide
    if (Object.keys(structuresDynamiques).length === 0) {
      structuresDynamiques[1] = { label: "Niveau 1", sb: 25, bb: 50, ante: 25, duree: dureeNiveauMinutesDefaut * 60 };
    }

    // 4. Inscriptions
    let sheetInsc = ss.getSheetByName("Inscriptions");
    if (!sheetInsc) {
      sheetInsc = ss.insertSheet("Inscriptions");
      sheetInsc.appendRow(["TournoiID", "Joueur", "Present", "DateInscription"]);
    }
    const dataInsc = sheetInsc.getDataRange().getValues();
    const inscriptions = {};
    
    for (let i = 1; i < dataInsc.length; i++) {
      const tId = dataInsc[i][0].toString();
      const jNom = dataInsc[i][1];
      const isPresent = dataInsc[i][2] === true || String(dataInsc[i][2]).toLowerCase() === "true";
      
      if (tId && jNom) {
        if (!inscriptions[tId]) inscriptions[tId] = {};
        inscriptions[tId][jNom] = { present: isPresent };
      }
    }

    // 5. Récupération du Classement Général (Ligne 5 à fin)
    let classementGeneral = [];
    const sheetClassement = ss.getSheetByName("Classement MTT");
    const tournoisTermines = {};

    if (sheetClassement) {
      const lastRow = Math.max(sheetClassement.getLastRow(), 58);
      const rangeData = sheetClassement.getRange(5, 1, lastRow - 4, 8).getValues();
      
      for (let r = 0; r < rangeData.length; r++) {
        const row = rangeData[r];
        const joueurNom = String(row[1] || "").trim();
        
        if (joueurNom !== "" && joueurNom.toLowerCase() !== "joueur" && joueurNom.toLowerCase() !== "pseudo") {
          classementGeneral.push({
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

      classementGeneral.sort((a, b) => a.classement - b.classement);

      const fullRows = sheetClassement.getDataRange().getValues();
      tournois.forEach(t => {
        let mttColIndex = -1;
        let jColIndex = -1;
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
              tournoisTermines[t.id] = String(fullRows[r][jColIndex]).trim();
              break;
            }
          }
        }
      });
    }

    // 6. États persistants (onglet State)
    let allStates = {};
    let sheetState = ss.getSheetByName("State");
    if (sheetState) {
      const rawState = sheetState.getRange("A1").getValue();
      if (rawState) {
        try { allStates = JSON.parse(rawState); } catch (e) {}
      }
    }

    const result = {
      joueurs: joueurs,
      tournois: tournois,
      prochainTournoiId: prochainTournoiId,
      inscriptions: inscriptions,
      maxJoueursParTable: maxJoueursParTable,
      startingStack: startingStack,
      structures: structuresDynamiques,
      allStates: allStates,
      tournoisTermines: tournoisTermines,
      classementGeneral: classementGeneral
    };

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const tournoiId = data.tournoiId;
    const action = data.action;

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Fonction utilitaire interne pour vérifier le rôle de maître (Sécurité anti-spectateur)[cite: 1]
    function verifierMastership() {
      let sheetState = ss.getSheetByName("State");
      if (!sheetState) return true;
      let allStates = {};
      let raw = sheetState.getRange("A1").getValue();
      if (raw) { try { allStates = JSON.parse(raw); } catch (e) {} }

      const currentState = allStates[tournoiId];
      const incomingMaster = data.state ? data.state.masterClientId : data.masterClientId;

      if (currentState && currentState.masterClientId && incomingMaster) {
        if (currentState.masterClientId !== incomingMaster) {
          return false; // Ce n'est pas le maître légitime
        }
      }
      return true;
    }

    if (action === "ajouterJoueur") {
      const nouveauJoueur = data.joueur;
      let sheetJoueurs = ss.getSheetByName("Joueurs");
      if (!sheetJoueurs) sheetJoueurs = ss.insertSheet("Joueurs");
      
      let existe = false;
      const rows = sheetJoueurs.getDataRange().getValues();
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][0]).trim().toLowerCase() === nouveauJoueur.toLowerCase()) {
          existe = true;
          break;
        }
      }
      if (!existe) sheetJoueurs.appendRow([nouveauJoueur]);
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "updateClassementBatch") {
      if (!verifierMastership()) {
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Action rejetée : Vous n'êtes plus le Maître du tournoi." })).setMimeType(ContentService.MimeType.JSON);
      }
      const classementMap = data.classementMap || {};
      const sheetClassement = ss.getSheetByName("Classement MTT");
      if (sheetClassement) {
        const rows = sheetClassement.getDataRange().getValues();
        let jCol = -1, mttCol = -1;

        for (let r = 0; r < rows.length; r++) {
          for (let c = 0; c < rows[r].length; c++) {
            const val = String(rows[r][c]).trim();
            if (val === "Joueur" && jCol === -1) jCol = c;
            if (val === `MTT ${tournoiId}` && mttCol === -1) mttCol = c;
          }
        }

        if (jCol !== -1 && mttCol !== -1) {
          for (let r = 0; r < rows.length; r++) {
            const nomJoueur = String(rows[r][jCol]).trim();
            if (classementMap.hasOwnProperty(nomJoueur)) {
              sheetClassement.getRange(r + 1, mttCol + 1).setValue(classementMap[nomJoueur]);
            }
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "resetTournament") {
      if (!verifierMastership()) {
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Action rejetée : Vous n'êtes plus le Maître du tournoi." })).setMimeType(ContentService.MimeType.JSON);
      }
      let sheetState = ss.getSheetByName("State");
      if (sheetState) {
        let allStates = {};
        let raw = sheetState.getRange("A1").getValue();
        if (raw) { try { allStates = JSON.parse(raw); } catch (e) {} }
        delete allStates[tournoiId];
        sheetState.getRange("A1").setValue(JSON.stringify(allStates));
      }

      const sheetClassement = ss.getSheetByName("Classement MTT");
      if (sheetClassement) {
        const rows = sheetClassement.getDataRange().getValues();
        let mttColIndex = -1;

        for (let r = 0; r < rows.length; r++) {
          for (let c = 0; c < rows[r].length; c++) {
            if (String(rows[r][c]).trim() === `MTT ${tournoiId}`) {
              mttColIndex = c;
              break;
            }
          }
          if (mttColIndex !== -1) break;
        }

        if (mttColIndex !== -1) {
          const lastRow = sheetClassement.getLastRow();
          if (lastRow >= 5) {
            sheetClassement.getRange(5, mttColIndex + 1, lastRow - 4, 1).clearContent();
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "saveState") {
      if (!verifierMastership()) {
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Action rejetée : Vous n'êtes plus le Maître du tournoi." })).setMimeType(ContentService.MimeType.JSON);
      }

      let sheetState = ss.getSheetByName("State");
      if (!sheetState) sheetState = ss.insertSheet("State");
      
      let allStates = {};
      let raw = sheetState.getRange("A1").getValue();
      if (raw) { try { allStates = JSON.parse(raw); } catch (e) {} }
      
      allStates[tournoiId] = data.state;
      sheetState.getRange("A1").setValue(JSON.stringify(allStates));
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "eliminer") {
      if (!verifierMastership()) {
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Action rejetée : Vous n'êtes plus le Maître du tournoi." })).setMimeType(ContentService.MimeType.JSON);
      }
      updateClassementSheet(ss, tournoiId, data.joueur, data.classement);
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "reintegrer") {
      if (!verifierMastership()) {
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Action rejetée : Vous n'êtes plus le Maître du tournoi." })).setMimeType(ContentService.MimeType.JSON);
      }
      const joueur = data.joueur;
      const eliminationsFutures = data.eliminationsFutures || [];

      const sheetClassement = ss.getSheetByName("Classement MTT");
      if (sheetClassement) {
        const rows = sheetClassement.getDataRange().getValues();
        let jCol = -1, mttCol = -1;

        for (let r = 0; r < rows.length; r++) {
          for (let c = 0; c < rows[r].length; c++) {
            const val = String(rows[r][c]).trim();
            if (val === "Joueur" && jCol === -1) jCol = c;
            if (val === `MTT ${tournoiId}` && mttCol === -1) mttCol = c;
          }
        }

        if (jCol !== -1 && mttCol !== -1) {
          for (let r = 0; r < rows.length; r++) {
            if (String(rows[r][jCol]).trim() === String(joueur).trim()) {
              sheetClassement.getRange(r + 1, mttCol + 1).setValue("");
              break;
            }
          }
          eliminationsFutures.forEach(item => {
            for (let r = 0; r < rows.length; r++) {
              if (String(rows[r][jCol]).trim() === String(item.joueur).trim()) {
                sheetClassement.getRange(r + 1, mttCol + 1).setValue(item.nouveauClassement);
                break;
              }
            }
          });
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    let sheetInsc = ss.getSheetByName("Inscriptions");
    if (!sheetInsc) {
      sheetInsc = ss.insertSheet("Inscriptions");
      sheetInsc.appendRow(["TournoiID", "Joueur", "Present", "DateInscription"]);
    }
    const rows = sheetInsc.getDataRange().getValues();

    if (action === "inscrire") {
      let existe = false;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0].toString() === tournoiId.toString() && rows[i][1] === data.joueur) {
          existe = true; break;
        }
      }
      if (!existe) sheetInsc.appendRow([tournoiId, data.joueur, false, new Date()]);
    } else if (action === "desinscrire") {
      for (let i = rows.length - 1; i >= 1; i--) {
        if (rows[i][0].toString() === tournoiId.toString() && rows[i][1] === data.joueur) {
          sheetInsc.deleteRow(i + 1);
        }
      }
    } else if (action === "present") {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0].toString() === tournoiId.toString() && rows[i][1] === data.joueur) {
          sheetInsc.getRange(i + 1, 3).setValue(data.present);
          break;
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function updateClassementSheet(ss, tournoiId, joueur, classement) {
  const sheetClassement = ss.getSheetByName("Classement MTT");
  if (sheetClassement) {
    const rows = sheetClassement.getDataRange().getValues();
    let jCol = -1, mttCol = -1;

    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const val = String(rows[r][c]).trim();
        if (val === "Joueur" && jCol === -1) jCol = c;
        if (val === `MTT ${tournoiId}` && mttCol === -1) mttCol = c;
      }
    }

    if (jCol !== -1 && mttCol !== -1) {
      for (let r = 0; r < rows.length; r++) {
        if (String(rows[r][jCol]).trim() === String(joueur).trim()) {
          sheetClassement.getRange(r + 1, mttCol + 1).setValue(classement);
          break;
        }
      }
    }
  }
}