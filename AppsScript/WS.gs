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

    // Mise à jour automatique des formules de liaison dans la colonne B de "Classement SNG"
    mettreAJourFormulesClassementSNG(ss, joueurs);

    // Helper pour lire le calendrier MTT ou SNG
    function readCalendar(sheetName, typePrefix) {
      const sheet = ss.getSheetByName(sheetName);
      const list = [];
      if (!sheet) return list;
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return list;
      for (let i = 2; i <= lastRow; i++) {
        const num = sheet.getRange(i, 1).getValue();
        const dateStr = sheet.getRange(i, 2).getDisplayValue().trim();
        const intitule = sheet.getRange(i, 3).getValue();

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

          const labelPrefix = typePrefix === "mtt" ? "MTT" : "SNG";
          const displayStr = dateFormatted ? `${intitule} - ${dateFormatted}` : `${intitule} (Date non définie)`;

          list.push({
            id: typePrefix + "_" + num.toString(),
            rawId: num.toString(),
            type: labelPrefix,
            intitule: intitule,
            date: dateFormatted,
            displayLabel: `[${labelPrefix}] ${displayStr}`,
            dateObj: dateObj
          });
        }
      }
      return list;
    }

    const mttTournois = readCalendar("Calendrier", "mtt");
    const sngTournois = readCalendar("Calendrier SNG", "sng");
    const tournois = [...mttTournois, ...sngTournois];

    // Tri chronologique des tournois par date
    tournois.sort((a, b) => {
      if (a.dateObj && b.dateObj) {
        return a.dateObj.getTime() - b.dateObj.getTime();
      }
      if (a.dateObj) return -1;
      if (b.dateObj) return 1;
      return a.id.localeCompare(b.id);
    });

    // Trouver le prochain tournoi
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let minDiff = Infinity;
    let prochainTournoiId = null;

    tournois.forEach(t => {
      if (t.dateObj && !isNaN(t.dateObj.getTime())) {
        t.dateObj.setHours(0, 0, 0, 0);
        const diff = t.dateObj.getTime() - today.getTime();
        if (diff >= 0 && diff < minDiff) {
          minDiff = diff;
          prochainTournoiId = t.id;
        }
      }
    });

    if (!prochainTournoiId && tournois.length > 0) {
      prochainTournoiId = tournois[0].id;
    }

    // Helper pour lire les structures (MTT ou SNG)
    function readStructure(sheetName) {
      let maxJoueursParTable = 6;
      let startingStack = 20000;
      let dureeNiveauMinutesDefaut = 20;
      let structuresDynamiques = {};

      try {
        const sheetStruct = ss.getSheetByName(sheetName);
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

      return { maxJoueursParTable, startingStack, structures: structuresDynamiques };
    }

    const structMTT = readStructure("Structure");
    const structSNG = readStructure("Structure SNG");

    // 4. Inscriptions (mutualisées dans l'onglet "Inscriptions")
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
        verifierEtAjouterJoueur(ss, jNom, joueurs);
      }
    }

    // 5. Classements Généraux (MTT & SNG)
    function readClassement(sheetName, relevantTournois, prefixType) {
      let classementGeneral = [];
      let tournoisTermines = {};
      const sheetClassement = ss.getSheetByName(sheetName);

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
            verifierEtAjouterJoueur(ss, joueurNom, joueurs);
          }
        }

        classementGeneral.sort((a, b) => a.classement - b.classement);

        const fullRows = sheetClassement.getDataRange().getValues();
        relevantTournois.forEach(t => {
          let colIndex = -1;
          let jColIndex = -1;
          const colHeader = prefixType === "MTT" ? `MTT ${t.rawId}` : `${t.intitule} - Table`;
          for (let r = 0; r < fullRows.length; r++) {
            for (let c = 0; c < fullRows[r].length; c++) {
              const val = String(fullRows[r][c]).trim();
              if (val === "Joueur" && jColIndex === -1) jColIndex = c;
              if (prefixType === "MTT" && val === colHeader && colIndex === -1) colIndex = c;
              if (prefixType === "SNG" && val.startsWith(`${t.intitule} - Table`) && colIndex === -1) colIndex = c;
            }
          }
          if (jColIndex !== -1 && colIndex !== -1) {
            for (let r = 0; r < fullRows.length; r++) {
              if (String(fullRows[r][colIndex]).trim() === "1") {
                tournoisTermines[t.id] = String(fullRows[r][jColIndex]).trim();
                break;
              }
            }
          }
        });
      }
      return { classementGeneral, tournoisTermines };
    }

    const mttData = readClassement("Classement MTT", mttTournois, "MTT");
    const sngData = readClassement("Classement SNG", sngTournois, "SNG");
    const tournoisTermines = { ...mttData.tournoisTermines, ...sngData.tournoisTermines };

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
      maxJoueursParTable: structMTT.maxJoueursParTable,
      startingStack: structMTT.startingStack,
      maxJoueursParTableSNG: structSNG.maxJoueursParTable,
      startingStackSNG: structSNG.startingStack,
      structures: {
        MTT: structMTT.structures,
        SNG: structSNG.structures
      },
      allStates: allStates,
      tournoisTermines: tournoisTermines,
      classementGeneralMTT: mttData.classementGeneral,
      classementGeneralSNG: sngData.classementGeneral
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

    const playerActions = ["inscrire", "desinscrire", "present"];
    if (playerActions.includes(action)) {
      const clientToken = data.masterToken;
      const serverToken = PropertiesService.getScriptProperties().getProperty('ACTIVE_MASTER_TOKEN');
      const isMasterAction = clientToken && clientToken === serverToken;

      if (!isMasterAction) {
        const clubPasswordSaisi = data.clubPassword;
        const expectedClubPassword = PropertiesService.getScriptProperties().getProperty('CLUB_PASSWORD');

        if (expectedClubPassword && clubPasswordSaisi !== expectedClubPassword) {
          return ContentService.createTextOutput(JSON.stringify({ 
            status: "error", 
            message: "Code secret du club incorrect. Action refusée." 
          })).setMimeType(ContentService.MimeType.JSON);
        }
      }
    }

    if (action === "ajouterJoueur") {
      const nouveauJoueur = data.joueur;
      let sheetJoueurs = ss.getSheetByName("Joueurs");
      if (!sheetJoueurs) sheetJoueurs = ss.insertSheet("Joueurs");
      
      let joueursActuels = sheetJoueurs.getLastRow() >= 2 ? sheetJoueurs.getRange("A2:A" + sheetJoueurs.getLastRow()).getValues().flat() : [];
      verifierEtAjouterJoueur(ss, nouveauJoueur, joueursActuels);
      mettreAJourFormulesClassementSNG(ss);
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "updateClassementBatch") {
      const classementMap = data.classementMap || {};
      const isSNG = tournoiId && tournoiId.startsWith("sng_");
      const sheetName = isSNG ? "Classement SNG" : "Classement MTT";
      const rawId = tournoiId.replace(/^(mtt_|sng_)/, "");
      const colPrefix = isSNG ? "SNG" : "MTT";

      const sheetClassement = ss.getSheetByName(sheetName);
      if (sheetClassement) {
        const rows = sheetClassement.getDataRange().getValues();
        let jCol = -1, targetCol = -1;

        for (let r = 0; r < rows.length; r++) {
          for (let c = 0; c < rows[r].length; c++) {
            const val = String(rows[r][c]).trim();
            if (val === "Joueur" && jCol === -1) jCol = c;
            if (val === `${colPrefix} ${rawId}` && targetCol === -1) targetCol = c;
          }
        }

        if (jCol !== -1 && targetCol !== -1) {
          for (let r = 0; r < rows.length; r++) {
            const nomJoueur = String(sheetClassement.getRange(r + 1, jCol + 1).getValue()).trim();
            if (classementMap.hasOwnProperty(nomJoueur)) {
              sheetClassement.getRange(r + 1, targetCol + 1).setValue(classementMap[nomJoueur]);
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

      const isSNG = tournoiId && tournoiId.startsWith("sng_");
      const sheetName = isSNG ? "Classement SNG" : "Classement MTT";
      const rawId = tournoiId.replace(/^(mtt_|sng_)/, "");
      
      const sheetClassement = ss.getSheetByName(sheetName);
      if (sheetClassement) {
        const rows = sheetClassement.getDataRange().getValues();
        if (isSNG) {
          let intituleTournoi = "SNG " + rawId;
          const sheetCalSNG = ss.getSheetByName("Calendrier SNG");
          if (sheetCalSNG) {
            const calData = sheetCalSNG.getDataRange().getValues();
            for (let i = 1; i < calData.length; i++) {
              if (String(calData[i][0]).trim() === String(rawId).trim()) {
                intituleTournoi = String(calData[i][2]).trim();
                break;
              }
            }
          }
          const prefixTarget = `${intituleTournoi} - Table`;
          for (let c = 0; c < rows[0].length; c++) {
            const cellVal = String(rows[0][c]).trim();
            if (cellVal.startsWith(prefixTarget)) {
              sheetClassement.getRange(5, c + 1, sheetClassement.getLastRow() - 4, 1).clearContent();
              sheetClassement.getRange(1, c + 1).setValue(""); // Effacer l'intitulé ligne 1
            }
          }
        } else {
          let colIndex = -1;
          for (let r = 0; r < rows.length; r++) {
            for (let c = 0; c < rows[r].length; c++) {
              if (String(rows[r][c]).trim() === `MTT ${rawId}`) {
                colIndex = c;
                break;
              }
            }
            if (colIndex !== -1) break;
          }
          if (colIndex !== -1) {
            const lastRow = sheetClassement.getLastRow();
            if (lastRow >= 5) {
              sheetClassement.getRange(5, colIndex + 1, lastRow - 4, 1).clearContent();
            }
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
      updateClassementSheet(ss, tournoiId, data.joueur, data.classement, data.tableNum);
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "reintegrer") {
      const joueur = data.joueur;
      const eliminationsFutures = data.eliminationsFutures || [];
      const isSNG = tournoiId && tournoiId.startsWith("sng_");
      const sheetName = isSNG ? "Classement SNG" : "Classement MTT";
      const rawId = tournoiId.replace(/^(mtt_|sng_)/, "");
      const colPrefix = isSNG ? "SNG" : "MTT";

      const sheetClassement = ss.getSheetByName(sheetName);
      if (sheetClassement) {
        const rows = sheetClassement.getDataRange().getValues();
        let jCol = -1, targetCol = -1;

        for (let r = 0; r < rows.length; r++) {
          for (let c = 0; c < rows[r].length; c++) {
            const val = String(rows[r][c]).trim();
            if (val === "Joueur" && jCol === -1) jCol = c;
            if (!isSNG && val === `${colPrefix} ${rawId}` && targetCol === -1) targetCol = c;
          }
        }

        if (isSNG) {
          let intituleTournoi = "SNG " + rawId;
          const sheetCalSNG = ss.getSheetByName("Calendrier SNG");
          if (sheetCalSNG) {
            const calData = sheetCalSNG.getDataRange().getValues();
            for (let i = 1; i < calData.length; i++) {
              if (String(calData[i][0]).trim() === String(rawId).trim()) {
                intituleTournoi = String(calData[i][2]).trim();
                break;
              }
            }
          }
          const prefixTarget = `${intituleTournoi} - Table`;
          for (let r = 0; r < rows.length; r++) {
            const cellVal = String(sheetClassement.getRange(r + 1, jCol + 1).getValue()).trim();
            if (cellVal.toLowerCase() === String(joueur).trim().toLowerCase()) {
              for (let c = 0; c < rows[0].length; c++) {
                if (String(rows[0][c]).trim().startsWith(prefixTarget)) {
                  sheetClassement.getRange(r + 1, c + 1).setValue("");
                }
              }
              break;
            }
          }
        } else if (jCol !== -1 && targetCol !== -1) {
          for (let r = 0; r < rows.length; r++) {
            const nomJ = String(sheetClassement.getRange(r + 1, jCol + 1).getValue()).trim();
            if (nomJ === String(joueur).trim()) {
              sheetClassement.getRange(r + 1, targetCol + 1).setValue("");
              break;
            }
          }
          eliminationsFutures.forEach(item => {
            for (let r = 0; r < rows.length; r++) {
              const nomJ = String(sheetClassement.getRange(r + 1, jCol + 1).getValue()).trim();
              if (nomJ === String(item.joueur).trim()) {
                sheetClassement.getRange(r + 1, targetCol + 1).setValue(item.nouveauClassement);
                break;
              }
            }
          });
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    // Inscriptions
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
      
      let sheetJoueurs = ss.getSheetByName("Joueurs");
      let joueursList = sheetJoueurs && sheetJoueurs.getLastRow() >= 2 ? sheetJoueurs.getRange("A2:A" + sheetJoueurs.getLastRow()).getValues().flat() : [];
      verifierEtAjouterJoueur(ss, data.joueur, joueursList);
      mettreAJourFormulesClassementSNG(ss);

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

// Fonction utilitaire pour vérifier et ajouter un joueur dans l'onglet "Joueurs"
function verifierEtAjouterJoueur(ss, nomJoueur, listeActuelle) {
  if (!nomJoueur || String(nomJoueur).trim() === "") return;
  const cleanNom = String(nomJoueur).trim();
  const existe = listeActuelle.some(j => String(j).trim().toLowerCase() === cleanNom.toLowerCase());
  if (!existe) {
    let sheetJoueurs = ss.getSheetByName("Joueurs");
    if (!sheetJoueurs) sheetJoueurs = ss.insertSheet("Joueurs");
    sheetJoueurs.appendRow([cleanNom]);
    listeActuelle.push(cleanNom);
  }
}

// Insère les formules d'égalité `=Joueurs!Ax` dans la colonne B (à partir de la ligne 5) de "Classement SNG"
function mettreAJourFormulesClassementSNG(ss, joueursList) {
  const sheetJoueurs = ss.getSheetByName("Joueurs");
  let sheetClassementSNG = ss.getSheetByName("Classement SNG");
  if (!sheetJoueurs || !sheetClassementSNG) return;

  if (!joueursList) {
    let lastRowJ = sheetJoueurs.getLastRow();
    if (lastRowJ >= 2) {
      joueursList = sheetJoueurs.getRange("A2:A" + lastRowJ).getValues().flat().filter(j => j !== "" && j !== undefined);
    } else {
      joueursList = [];
    }
  }

  for (let i = 0; i < joueursList.length; i++) {
    let rowIndex = 5 + i;
    let joueurRowInJoueursTab = i + 2;
    let formula = `=Joueurs!A${joueurRowInJoueursTab}`;
    sheetClassementSNG.getRange(rowIndex, 2).setValue(formula);
  }
}

function updateClassementSheet(ss, tournoiId, joueur, classement, tableNum) {
  const isSNG = tournoiId && tournoiId.startsWith("sng_");
  const sheetName = isSNG ? "Classement SNG" : "Classement MTT";
  const rawId = tournoiId.replace(/^(mtt_|sng_)/, "");

  const sheetClassement = ss.getSheetByName(sheetName);
  if (!sheetClassement) return;

  const rows = sheetClassement.getDataRange().getValues();
  let jCol = -1;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (String(rows[r][c]).trim() === "Joueur") {
        jCol = c;
        break;
      }
    }
    if (jCol !== -1) break;
  }
  if (jCol === -1) jCol = 1; // par défaut colonne B (index 1)

  if (isSNG) {
    let intituleTournoi = "SNG " + rawId;
    const sheetCalSNG = ss.getSheetByName("Calendrier SNG");
    if (sheetCalSNG) {
      const calData = sheetCalSNG.getDataRange().getValues();
      for (let i = 1; i < calData.length; i++) {
        if (String(calData[i][0]).trim() === String(rawId).trim()) {
          intituleTournoi = String(calData[i][2]).trim();
          break;
        }
      }
    }

    const targetHeader = `${intituleTournoi} - Table ${tableNum}`;
    let headerColIndex = -1;

    for (let c = 0; c < rows[0].length; c++) {
      if (String(rows[0][c]).trim() === targetHeader) {
        headerColIndex = c;
        break;
      }
    }

    if (headerColIndex === -1) {
      for (let c = 0; c < rows[0].length; c += 2) {
        if (!rows[0][c] || String(rows[0][c]).trim() === "") {
          headerColIndex = c;
          break;
        }
      }
      if (headerColIndex === -1) {
        headerColIndex = rows[0].length;
      }
      sheetClassement.getRange(1, headerColIndex + 1).setValue(targetHeader);
    }

    const currentValues = sheetClassement.getDataRange().getValues();
    for (let r = 0; r < currentValues.length; r++) {
      const cellValue = String(sheetClassement.getRange(r + 1, jCol + 1).getValue()).trim();
      if (cellValue.toLowerCase() === String(joueur).trim().toLowerCase()) {
        sheetClassement.getRange(r + 1, headerColIndex + 1).setValue(classement);
        break;
      }
    }

  } else {
    let mttCol = -1;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (String(rows[r][c]).trim() === `MTT ${rawId}`) {
          mttCol = c;
          break;
        }
      }
      if (mttCol !== -1) break;
    }

    if (jCol !== -1 && mttCol !== -1) {
      for (let r = 0; r < rows.length; r++) {
        const nomJ = String(sheetClassement.getRange(r + 1, jCol + 1).getValue()).trim();
        if (nomJ === String(joueur).trim()) {
          sheetClassement.getRange(r + 1, mttCol + 1).setValue(classement);
          break;
        }
      }
    }
  }
}