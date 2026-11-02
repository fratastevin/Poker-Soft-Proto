// --- GOOGLE APPS SERVICE BACKEND SÉCURISÉ ---

function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. Récupération des joueurs
    const sheetJoueurs = ss.getSheetByName("Joueurs");
    let joueurs = [];
    if (sheetJoueurs && sheetJoueurs.getLastRow() >= 2) {
      const dataJoueurs = sheetJoueurs.getRange("A2:A" + sheetJoueurs.getLastRow()).getValues();
      joueurs = dataJoueurs.map(row => row[0]).filter(j => j !== "" && j !== undefined);
    }

    // 2. Récupération du calendrier
    const sheetCal = ss.getSheetByName("Calendrier");
    const tournois = [];
    let prochainTournoiId = null;

    if (sheetCal) {
      const lastRowCal = sheetCal.getLastRow();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
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
    }

    if (!prochainTournoiId && tournois.length > 0) {
      prochainTournoiId = tournois[0].id;
    }

    // 3. Paramètres Structure
    let maxJoueursParTable = 6;
    let startingStack = 20000;
    let dureeNiveauMinutesDefaut = 20;
    let structuresDynamiques = {};

    try {
      const sheetStruct = ss.getSheetByName("Structure");
      if (sheetStruct) {
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

        for (let i = 4; i < structData.length; i++) {
          const row = structData[i];
          const valNiveau = String(row[0]).trim();
          if (valNiveau === "" || valNiveau.toLowerCase() === "total" || valNiveau.toLowerCase() === "moyenne") break;

          const isPause = valNiveau.toLowerCase().includes("pause") || valNiveau.toLowerCase().includes("break");
          const sb = parseFloat(row[1]) || 0;
          const bb = parseFloat(row[2]) || 0;
          const ante = parseFloat(row[3]) || 0;
          
          let indexNiveau = i - 3;
          structuresDynamiques[indexNiveau] = {
            label: isPause ? "Pause" : `Niveau ${valNiveau}`,
            sb: sb,
            bb: bb,
            ante: ante,
            duree: dureeNiveauMinutesDefaut * 60,
            isPause: isPause
          };
        }
      }
    } catch (err) {}

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

    // 5. Classement Général
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

    // 6. États persistants
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
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ 
      status: "error", 
      message: "Serveur occupé, veuillez réitérer l'action." 
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const data = JSON.parse(e.postData.contents);
    const tournoiId = data.tournoiId;
    const action = data.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // --- 1. CONNEXION ADMIN (ADMIN_USER + MASTER_PASSWORD) ---
    if (action === "loginMaster") {
      const username = data.username;
      const password = data.password;
      const expectedUser = PropertiesService.getScriptProperties().getProperty('ADMIN_USER') || "BureauVPC";
      const expectedPassword = PropertiesService.getScriptProperties().getProperty('MASTER_PASSWORD');

      if (!expectedPassword) {
        return ContentService.createTextOutput(JSON.stringify({ 
          status: "error", 
          message: "Propriété MASTER_PASSWORD non configurée dans Apps Script." 
        })).setMimeType(ContentService.MimeType.JSON);
      }

      if (username === expectedUser && password === expectedPassword) {
        const masterToken = 'token_master_' + Math.random().toString(36).substr(2, 12);
        PropertiesService.getScriptProperties().setProperty('ACTIVE_MASTER_TOKEN', masterToken);
        return ContentService.createTextOutput(JSON.stringify({ 
          status: "success", 
          masterToken: masterToken 
        })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({ 
          status: "error", 
          message: "Identifiant ou mot de passe Administrateur incorrect." 
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // --- 1B. VÉRIFICATION DU CODE CLUB (CLUB_PASSWORD) ---
    if (action === "verifyClubPassword") {
      const clubPasswordSaisi = data.clubPassword;
      const expectedClubPassword = PropertiesService.getScriptProperties().getProperty('CLUB_PASSWORD');

      if (!expectedClubPassword) {
        return ContentService.createTextOutput(JSON.stringify({ 
          status: "error", 
          message: "Propriété CLUB_PASSWORD non configurée dans Apps Script." 
        })).setMimeType(ContentService.MimeType.JSON);
      }

      if (clubPasswordSaisi === expectedClubPassword) {
        return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({ 
          status: "error", 
          message: "Code secret du club incorrect." 
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // --- 2. CONTRÔLE DE SÉCURITÉ POUR ACTIONS ADMIN ---
    const adminActions = ["saveState", "eliminer", "reintegrer", "updateClassementBatch", "resetTournament", "ajouterJoueur"];
    if (adminActions.includes(action)) {
      const clientToken = data.masterToken;
      const serverToken = PropertiesService.getScriptProperties().getProperty('ACTIVE_MASTER_TOKEN');

      if (!clientToken || clientToken !== serverToken) {
        return ContentService.createTextOutput(JSON.stringify({ 
          status: "error", 
          message: "Accès refusé : Authentification Administrateur requise." 
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // --- 3. CONTRÔLE DE SÉCURITÉ CODE CLUB POUR LES JOUEURS ---
    const playerActions = ["inscrire", "desinscrire", "present"];
    if (playerActions.includes(action)) {
      const clubPasswordSaisi = data.clubPassword;
      const expectedClubPassword = PropertiesService.getScriptProperties().getProperty('CLUB_PASSWORD');

      if (expectedClubPassword && clubPasswordSaisi !== expectedClubPassword) {
        return ContentService.createTextOutput(JSON.stringify({ 
          status: "error", 
          message: "Code secret du club incorrect. Action refusée." 
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // --- EXECUTION DES ACTIONS ---
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
      updateClassementSheet(ss, tournoiId, data.joueur, data.classement);
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "reintegrer") {
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
  } finally {
    lock.releaseLock();
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