function checkMastershipBeforeAction() {
    if (!isMaster) {
        alert("⚠️ Action refusée : Vous devez d'abord vous authentifier en tant que Maître (bouton 👑 Master).");
        return false;
    }
    return true;
}

function lockLiveInterfaceForSpectator(lock) {
    const banner = document.getElementById('spectator-banner');
    banner.style.display = lock ? 'block' : 'none';
}

function mettreAJourBoutonMasterUI() {
    const btnMaster = document.getElementById('btn-master-toggle');
    if (!btnMaster) return;

    const masterContainer = document.getElementById('master-last-minute-container');
    if (masterContainer) {
        masterContainer.style.display = isMaster ? 'flex' : 'none';
    }

    if (isMaster) {
        btnMaster.innerText = "👑 Master (Déco)";
        btnMaster.style.backgroundColor = "#059669";
        lockLiveInterfaceForSpectator(false);
    } else {
        btnMaster.innerText = "👑 Master";
        btnMaster.style.backgroundColor = "#7c3aed";
        lockLiveInterfaceForSpectator(true);
    }
}

function gererBoutonMaster() {
    if (isMaster) {
        if (confirm("Voulez-vous vous déconnecter du mode Administrateur (Master) ?")) {
            isMaster = false;
            masterToken = null;
            sessionStorage.removeItem('poker_is_master');
            sessionStorage.removeItem('poker_master_token');
            mettreAJourBoutonMasterUI();
            alert("🔓 Vous êtes déconnecté du mode Master (mode spectateur activé).");
        }
    } else {
        ouvrirModalLoginMaster();
    }
}

function ouvrirModalLoginMaster() {
    const oldModal = document.getElementById('custom-modal-login');
    if (oldModal) oldModal.remove();

    const modalHtml = `
        <div id="custom-modal-login" class="modal-overlay">
            <div class="modal-box">
                <h3>Connexion Administrateur</h3>
                <label>Identifiant :</label>
                <input type="text" id="modal-user" placeholder="Nom d'utilisateur" autocomplete="username">
                <label>Mot de passe :</label>
                <input type="password" id="modal-password" placeholder="••••••••" autocomplete="current-password">
                <div class="modal-buttons">
                    <button onclick="fermerModalLogin()" style="background:#475569; width:auto; padding:0.5rem 1rem;">Annuler</button>
                    <button onclick="validerLoginMaster()" class="btn-purple" style="width:auto; padding:0.5rem 1rem;">Connexion</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.getElementById('modal-user').focus();

    const inputPwd = document.getElementById('modal-password');
    inputPwd.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') validerLoginMaster();
    });
}

function fermerModalLogin() {
    const modal = document.getElementById('custom-modal-login');
    if (modal) modal.remove();
}

async function validerLoginMaster() {
    const userSaisi = document.getElementById('modal-user').value.trim();
    const pwdSaisi = document.getElementById('modal-password').value;

    if (!userSaisi || !pwdSaisi) {
        alert("Veuillez remplir tous les champs.");
        return;
    }

    fermerModalLogin();

    try {
        const response = await fetch(scriptUrl, {
            method: "POST",
            body: JSON.stringify({
                action: "loginMaster",
                username: userSaisi,
                password: pwdSaisi
            })
        });
        const result = await response.json();

        if (result.status === "success") {
            masterToken = result.masterToken;
            isMaster = true;
            
            sessionStorage.setItem('poker_is_master', 'true');
            sessionStorage.setItem('poker_master_token', masterToken);

            mettreAJourBoutonMasterUI();

            if (scriptUrl && activeTournoiId) {
                if (!appData.allStates) appData.allStates = {};
                if (!appData.allStates[activeTournoiId]) appData.allStates[activeTournoiId] = {};
                appData.allStates[activeTournoiId].masterClientId = myClientId;
                saveGameStateToSheet();
            }
            alert("👑 Authentification réussie : Vous êtes connecté en tant que Maître du Tournoi.");
            flushPendingQueue();
            startGlobalSync();
        } else {
            alert("❌ " + (result.message || "Identifiant ou mot de passe incorrect."));
        }
    } catch (err) {
        console.error("Erreur d'authentification master:", err);
        alert("Erreur de communication avec le serveur Google Apps Script.");
    }
}

function demanderMotDePasseClubAsync() {
    return new Promise((resolve) => {
        const oldModal = document.getElementById('custom-modal-club');
        if (oldModal) oldModal.remove();

        const modalHtml = `
            <div id="custom-modal-club" class="modal-overlay">
                <div class="modal-box">
                    <h3>Code Secret du Club</h3>
                    <label>Entrez le mot de passe joueur :</label>
                    <input type="password" id="modal-club-password" placeholder="••••••••" autocomplete="current-password">
                    <div class="modal-buttons">
                        <button onclick="fermerModalClub(null)" style="background:#475569; width:auto; padding:0.5rem 1rem;">Annuler</button>
                        <button onclick="soumettreModalClub()" class="btn-green" style="width:auto; padding:0.5rem 1rem;">Valider</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const inputPwd = document.getElementById('modal-club-password');
        inputPwd.focus();
        inputPwd.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') soumettreModalClub();
        });

        window._resolveClubPrompt = resolve;
    });
}

function fermerModalClub(valeur) {
    const modal = document.getElementById('custom-modal-club');
    if (modal) modal.remove();
    if (window._resolveClubPrompt) {
        window._resolveClubPrompt(valeur);
        window._resolveClubPrompt = null;
    }
}

async function soumettreModalClub() {
    const pwdSaisi = document.getElementById('modal-club-password').value;
    if (!pwdSaisi) {
        alert("Veuillez entrer le mot de passe.");
        return;
    }

    try {
        const response = await fetch(scriptUrl, {
            method: "POST",
            body: JSON.stringify({
                action: "verifyClubPassword",
                clubPassword: pwdSaisi
            })
        });
        const result = await response.json();

        if (result.status === "success") {
            fermerModalClub(pwdSaisi);
        } else {
            alert("❌ " + (result.message || "Code secret du club incorrect."));
        }
    } catch (err) {
        console.error("Erreur vérification code club:", err);
        alert("Erreur de communication avec le serveur.");
    }
}
