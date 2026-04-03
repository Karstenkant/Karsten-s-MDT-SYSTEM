// ============================================
// POLITI MDT v3.0 - Professionelt Dansk System
// ============================================

let currentSession = null;
let currentProfile = null;
let selectedCrimes = []; // Liste over valgte paragraffer til beregning
let isLoggingOut = false;

// P_MAP er fjernet til fordel for direkte opslag i databasen.


// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    // Aktiver ikoner
    if (window.lucide) window.lucide.createIcons();

    const session = await _supabase.auth.getSession();
    if (!session.data.session) {
        if (!window.location.href.includes('login.html')) {
            window.location.href = 'login.html';
        }
        return;
    }
    
    currentSession = session.data.session;
    await loadProfile();
    initDashboard();
});

async function loadProfile() {
    try {
        const { data: profile, error } = await _supabase
            .from('betjente')
            .select('*')
            .eq('id', currentSession.user.id)
            .single();

        if (error) {
            console.error("Kunne ikke hente profil:", error.message);
            // Fallback profil men med korrekt ID fra sessionen
            currentProfile = { 
                id: currentSession.user.id,
                navn: currentSession.user.user_metadata?.navn || "Betjent", 
                p_nummer: currentSession.user.user_metadata?.p_nummer || "P-???", 
                rolle: "betjent", 
                is_on_duty: false 
            };
        } else {
            currentProfile = profile;
        }

        updateUIProfile();
        checkDutyStatus();
    } catch (err) {
        console.error("Kritisk fejl i loadProfile:", err);
        // Prøv at bruge session-data hvis opslaget fejler
        currentProfile = { 
            id: currentSession.user.id,
            email: currentSession.user.email,
            navn: "Betjent", 
            p_nummer: "Henter...", 
            rolle: "betjent", 
            is_on_duty: false 
        };
        updateUIProfile();
    }
}

// ============================================
// DASHBOARD CORE
// ============================================
async function initDashboard() {
    if (!document.getElementById('welcome-msg')) return;

    // 1. Vis/Skjul elementer baseret på profil
    updateUIProfile();
    
    // 2. Tjek FLÅDE SYSTEM (Vagt status)
    checkDutyStatus();

    // 3. Navigation
    setupNavigation();

    // 4. Live Systemer
    startLiveSystems();

    // 5. Load Data
    updateStats();
    updateFleet();
    loadCriminalCode();
    loadSager();
    loadBoeder();
    loadStraffeattester();
    loadEfterlyste();
    if (isAdmin()) {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block');
        setupAdminPanel();
    }

    // 6. Listeners
    setupEventListeners();

    // 7. Profile Dropdown Logic
    setupProfileDropdown();

    // 8. Profile & Password Listeners
    setupProfileListeners();
}

function setupProfileDropdown() {
    const toggle = document.getElementById('profile-toggle');
    const menu = document.getElementById('profile-menu');
    
    if (toggle && menu) {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
        });

        document.addEventListener('click', () => {
            menu.style.display = 'none';
        });

        menu.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        document.getElementById('nav-profile')?.addEventListener('click', () => {
            showProfileModal();
            menu.style.display = 'none';
        });
    }
}

function showProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (modal) modal.style.display = 'flex';
}

function closeProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (modal) modal.style.display = 'none';
    const msg = document.getElementById('profile-msg');
    if (msg) msg.innerText = '';
}

function updateUIProfile() {
    const badge = document.getElementById('user-badge');
    const displayName = document.getElementById('user-display-name');
    const pnum = document.getElementById('pnum-display');
    const adminTab = document.querySelector('.admin-only');
    
    if (currentProfile) {
        if (badge) badge.innerText = currentProfile.navn;
        if (displayName) displayName.innerText = currentProfile.navn;
        if (pnum) pnum.innerText = currentProfile.p_nummer || 'P-???';
        
        const unitEl = document.getElementById('unit-display');
        if (unitEl) unitEl.innerText = `Enhed: ${currentProfile.current_unit || '--'}`;

        // Admin tjek
        const userEmail = currentSession?.user?.email?.toLowerCase() || "";
        const isMasterAdmin = (
            userEmail === "haladyndan123@aarhus.dk" ||
            userEmail === "admin@aarhus.dk"
        );

        if (adminTab) {
            adminTab.style.display = isMasterAdmin ? 'inline-block' : 'none';
        }
    }
}

function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const target = item.getAttribute('data-target');
            if (!target) return;

            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            const targetEl = document.getElementById(target);
            if (targetEl) targetEl.classList.add('active');

            // Trigger loaders baseret på fane
            if (target === 'wanted-section') loadEfterlyste();

            // NYT: Luk alle modals når man skifter fane
            document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
            document.querySelectorAll('.attest-inline-container').forEach(c => c.style.display = 'none');
        });
    });
}

function startLiveSystems() {
    // Live Ur
    setInterval(() => {
        const now = new Date();
        const clockEl = document.getElementById('live-clock');
        if (clockEl) clockEl.innerText = now.toLocaleTimeString('da-DK', { hour12: false });
    }, 1000);

    // Auto-update stats & fleet hver 30. sekund
    setInterval(() => {
        updateStats();
        updateFleet();
        loadEfterlyste();
        heartbeat();
    }, 30000);
}

// Heartbeat opdaterer databasen så man ikke bliver fjernet fra flåden pga. inaktivitet
async function heartbeat() {
    if (currentProfile?.is_on_duty) {
        await _supabase.from('betjente').update({ last_active: new Date().toISOString() }).eq('id', currentProfile.id);
    }
}

// ============================================
// FLÅDE & VAGT SYSTEM
// ============================================
function checkDutyStatus() {
    const overlay = document.getElementById('duty-overlay');
    if (!overlay) return;

    // Sikkerhedscheck: hvis profil mangler, vis overlay indtil fix
    if (!currentProfile || !currentProfile.is_on_duty) {
        overlay.style.display = 'flex';
        setupDutySelector();
    } else {
        overlay.style.display = 'none';
        const unitEl = document.getElementById('unit-display');
        if (unitEl) unitEl.innerText = `ENHED: ${currentProfile.current_unit || 'INGEN'}`;
    }
}

function setupDutySelector() {
    const chips = document.querySelectorAll('.unit-chip');
    let selectedUnit = 'Patrulje';

    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            chips.forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
            selectedUnit = chip.dataset.unit;
        });
    });

    const dutyBtn = document.getElementById('go-on-duty-btn');
    if (dutyBtn) {
        dutyBtn.addEventListener('click', async () => {
            const pnumInput = document.getElementById('confirm-pnum').value.trim().toUpperCase();
            const msg = document.getElementById('duty-msg');

            // Dynamisk tjek af P-nummer mod databasen
            const { data: validOfficer, error: pError } = await _supabase
                .from('betjente')
                .select('*')
                .eq('p_nummer', pnumInput)
                .maybeSingle();

            if (pError || !validOfficer) {
                msg.innerText = 'FEJL: P-nummeret findes ikke i systemet.';
                return;
            }

            // Tjek om P-nummeret tilhører den loggede ind bruger
            if (validOfficer.email !== currentSession.user.email) {
                msg.innerText = 'FEJL: Dette P-nummer tilhører en anden konto.';
                return;
            }

            // Meld på vagt og opdater profil-data
            const userId = currentSession?.user?.id;
            if (!userId) {
                msg.innerText = 'FEJL: Ingen aktiv session fundet. Log ind igen.';
                return;
            }

            // Vi bruger upsert i stedet for update for at være sikre på at rækken findes
            const { error } = await _supabase.from('betjente').upsert({
                id: userId,
                is_on_duty: true,
                current_unit: selectedUnit,
                p_nummer: pnumInput,
                navn: currentProfile?.navn || "Ukendt Betjent",
                email: currentSession.user.email
            }, { onConflict: 'id' });

            if (!error) {
                if (currentProfile) {
                    currentProfile.is_on_duty = true;
                    currentProfile.current_unit = selectedUnit;
                    currentProfile.p_nummer = pnumInput;
                }
                
                document.getElementById('duty-overlay').style.display = 'none';
                const unitEl = document.getElementById('unit-display');
                if (unitEl) unitEl.innerText = `ENHED: ${selectedUnit}`;
                
                updateUIProfile();
                showToast(`Du er nu tilkoblet som ${selectedUnit}`);
                updateStats();
            } else {
                msg.innerText = `FEJL: Database-fejl (${error.message || error.code})`;
                console.error("Database Update Error:", error);
            }
        });
    }

    // ADMIN BYPASS LOGIK
    const adminLoginBtn = document.getElementById('admin-login-btn');
    if (adminLoginBtn) {
        adminLoginBtn.addEventListener('click', async () => {
            const emailInput = document.getElementById('admin-email-login').value.trim();
            const msg = document.getElementById('duty-msg');

            // Hardcoded master admin check for the user's Discord ID
            const masterDiscordId = "930839631946211358";
            
            // Vi tjekker om den loggede ind bruger matcher enten den indtastede mail (hvis admin) 
            // eller om deres profil er markeret som admin
            if (!emailInput) {
                msg.innerText = 'Indtast venligst en admin-email.';
                return;
            }

            const { data: adminProfile, error } = await _supabase
                .from('betjente')
                .select('*')
                .ilike('email', emailInput)
                .single();

            // Særlig bypass for ejeren
            const input = emailInput.toLowerCase();
            const isAdminEmail = (
                input === "haladyndan123@aarhus.dk" ||
                input === "admin@aarhus.dk"
            );

            if (isAdminEmail || (adminProfile && adminProfile.rolle === 'admin')) {
                // Godkend bypass
                document.getElementById('duty-overlay').style.display = 'none';
                const unitEl = document.getElementById('unit-display');
                if (unitEl) unitEl.innerText = `ENHED: ADMIN-MODE`;
                showToast('Admin bypass godkendt. Velkommen.');
                updateStats();
            } else {
                msg.innerText = 'FEJL: Adgang nægtet. Kun for administratorer.';
                return;
            }
        });
    }
}

// ============================================
// STRAFFE-BEREGNER
// ============================================
async function loadCriminalCode() {
    const container = document.getElementById('straffe-katalog');
    if (!container) return;

    const { data: laws, error } = await _supabase.from('straffelov').select('*').order('paragraf');
    if (error) return;

    container.innerHTML = '';
    laws.forEach(law => {
        const div = document.createElement('div');
        div.className = 'lov-item';
        div.dataset.id = law.id; // Gem unikt ID
        div.innerHTML = `
            <div>
                <strong style="color:var(--police-accent);">${law.paragraf}</strong> - ${law.titel}
            </div>
            <div style="font-size:0.8rem; color:var(--police-text-muted);">
                ${law.fine_amount ? law.fine_amount.toLocaleString() + ' kr.' : ''} 
                ${law.jail_days ? ' | ' + law.jail_days + ' dg.' : ''}
            </div>
        `;
        div.addEventListener('click', () => toggleCrime(law));
        container.appendChild(div);
    });
}

function toggleCrime(law) {
    const idx = selectedCrimes.findIndex(c => c.id === law.id);
    if (idx > -1) {
        selectedCrimes.splice(idx, 1);
    } else {
        selectedCrimes.push(law);
    }
    updatePenaltySummary();
    
    // Opdater kun den specifikke række baseret på ID (fjerner fejlen hvor flere lyser op)
    document.querySelectorAll('.lov-item').forEach(el => {
        if (el.dataset.id === law.id.toString()) {
            el.style.background = selectedCrimes.find(c => c.id === law.id) ? 'rgba(59, 130, 246, 0.2)' : 'transparent';
        }
    });
}

function updatePenaltySummary() {
    let totalFine = 0;
    let totalJail = 0;

    selectedCrimes.forEach(c => {
        totalFine += c.fine_amount || 0;
        totalJail += c.jail_days || 0;
    });

    const fineEl = document.getElementById('sum-fine');
    const jailEl = document.getElementById('sum-jail');
    if (fineEl) fineEl.innerText = totalFine.toLocaleString() + ' kr.';
    if (jailEl) jailEl.innerText = totalJail + ' dage';
}

document.getElementById('create-boede-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (selectedCrimes.length === 0) return alert('Vælg mindst én paragraf!');

    try {
        const borger = document.getElementById('boede-borger').value;
        const aarsag = document.getElementById('boede-aarsag').value;
        
        let totalFine = 0;
        let totalJail = 0;
        let paragraffer = selectedCrimes.map(c => c.paragraf).join(', ');

        selectedCrimes.forEach(c => {
            totalFine += c.fine_amount || 0;
            totalJail += c.jail_days || 0;
        });

        const { error } = await _supabase.from('boeder').insert([{
            user_name: borger,
            user_discord_id: borger, // Vi bruger navnet som ID hvis ikke andet haves
            amount: totalFine,
            jail_days: totalJail,
            paragraf: paragraffer,
            reason: aarsag,
            officer_id: currentProfile.id,
            officer_name: currentProfile.navn,
            kilde: 'web'
        }]);

        if (!error) {
            showToast('Straf er udstedt og journalført.');
            selectedCrimes = [];
            updatePenaltySummary();
            e.target.reset();
            loadBoeder();
            loadStraffeattester();
            // Nulstil highlights
            document.querySelectorAll('.lov-item').forEach(el => el.style.background = 'transparent');
        } else {
            console.error('Supabase fejl:', error);
            alert('Fejl ved journalføring: ' + error.message);
        }
    } catch (error) {
        console.error('Der skete en fejl i systemet:', error);
    }
});

// ============================================
// STATS & DATA
// ============================================
async function updateStats() {
    const { count: sager } = await _supabase.from('sager').select('*', { count: 'exact', head: true });
    const sagerEl = document.getElementById('stat-total-sager');
    if (sagerEl) sagerEl.innerText = sager || 0;

    const { count: wantedCount } = await _supabase.from('efterlyste').select('*', { count: 'exact', head: true });
    const wantedEl = document.getElementById('stat-wanted');
    if (wantedEl) wantedEl.innerText = wantedCount || 0;

    const { count: borgere } = await _supabase.from('borgere').select('*', { count: 'exact', head: true });
    const borgereEl = document.getElementById('stat-born');
    if (borgereEl) borgereEl.innerText = borgere || 0;

    const { count: aktive } = await _supabase.from('betjente').select('*', { count: 'exact', head: true }).eq('is_on_duty', true);
    const activeEl = document.getElementById('stat-active');
    if (activeEl) activeEl.innerText = aktive || 0;

    const { data: activity } = await _supabase.from('boeder').select('*').order('created_at', { ascending: false }).limit(5);
    const feed = document.getElementById('recent-activity');
    if (feed) {
        feed.innerHTML = activity?.map(a => `
            <div style="margin-bottom:10px; border-bottom:1px solid #334155; padding-bottom:5px;">
                <span class="badge" style="background:var(--police-accent);">BØDE</span> 
                <strong>${a.user_name}</strong> fik ${a.amount.toLocaleString()} kr. af ${a.officer_name}
            </div>
        `).join('') || 'Ingen nylig aktivitet.';
    }
    updateFleet();
}

async function updateFleet() {
    const list = document.getElementById('active-units');
    if (!list) return;

    try {
        // Vi henter kun folk der er på vagt OG som har været aktive indenfor de sidste 10 minutter
        // Dette fjerner automatisk folk der bare har lukket deres browser uden at logge af.
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

        const { data: officers, error } = await _supabase
            .from('betjente')
            .select('navn, p_nummer, current_unit')
            .eq('is_on_duty', true)
            .gt('last_active', tenMinutesAgo)
            .order('current_unit');

        if (error) {
            list.innerHTML = `<div class="error">Fejl: ${error.message}</div>`;
            return;
        }

        if (!officers || officers.length === 0) {
            list.innerHTML = '<div style="color:var(--police-text-muted); text-align:center; padding:15px; font-size:0.9rem;">Ingen betjente på vagt lige nu.</div>';
            return;
        }

        list.innerHTML = officers.map(u => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(15,23,42,0.4); padding:12px; border-radius:10px; margin-bottom:10px; border-left:4px solid var(--police-accent); border:1px solid var(--police-border); border-left-width:4px;">
                <div>
                    <div style="font-weight:700; color:white; font-size:1.1rem;">${u.p_nummer}</div>
                    <div style="font-size:0.85rem; color:var(--police-text-muted);">${u.navn}</div>
                </div>
                <div style="text-align:right;">
                    <span class="badge" style="background:rgba(59, 130, 246, 0.1); color:var(--police-accent); border:1px solid rgba(59, 130, 246, 0.2); font-size:0.7rem; padding:4px 10px;">
                        ${u.current_unit?.toUpperCase() || 'PATRULJE'}
                    </span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error("Fejl i updateFleet:", err);
        list.innerHTML = '<div class="error">Kunne ikke hente flåde-data.</div>';
    }
}

async function loadBoeder() {
    const list = document.getElementById('boeder-liste');
    if (!list) return;
    const { data } = await _supabase.from('boeder').select('*').is('slettet_dato', null).order('created_at', { ascending: false });
    list.innerHTML = data?.map(b => `
        <div class="stat-card" style="margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between;">
                <strong>⚖️ ${b.user_name}</strong>
                <span class="badge ${b.afsonet ? 'on-duty-badge' : 'off-duty-badge'}">${b.afsonet ? 'AFSONET' : 'MANGLER'}</span>
            </div>
            <div style="margin-top:5px; font-size:0.9rem;">
                ${b.amount.toLocaleString()} kr. | ${b.jail_days || 0} dage<br>
                <span style="color:var(--police-text-muted); font-size:0.8rem;">${b.paragraf}</span>
            </div>
        </div>
    `).join('') || 'Ingen bøder.';
}

async function loadStraffeattester(query = '') {
    const list = document.getElementById('attester-liste');
    if (!list) return;
    const { data: borgere } = await _supabase.from('borgere').select('*').order('visningsnavn');
    
    list.innerHTML = borgere?.filter(b => b.visningsnavn.toLowerCase().includes(query.toLowerCase())).map(b => `
        <div class="attester-item-wrapper" style="margin-bottom:10px;">
            <div class="lov-item" onclick="viewAttest('${b.discord_id}')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                <span>👤 ${b.visningsnavn}</span>
                <span style="font-size:0.8rem; color:var(--police-accent); font-weight:700;">KLIK FOR ATTEST</span>
            </div>
            <div id="attest-inline-${b.discord_id}" class="attest-inline-container">
                <!-- Indhold indlæses her -->
            </div>
        </div>
    `).join('') || 'Ingen borgere fundet.';
}

// ============================================
// ADMIN PANEL LOGIK
// ============================================
async function setupAdminPanel() {
    loadAdminUsers();
    const form = document.getElementById('create-user-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('new-user-name').value;
            const email = document.getElementById('new-user-email').value;
            const pass = document.getElementById('new-user-pass').value;
            const pnum = document.getElementById('new-user-pnum').value.trim();
            const discord = document.getElementById('new-user-discord').value;
            const role = document.getElementById('new-user-role').value;

            const { error } = await _supabase.from('pending_users').insert([{
                name: name,
                email: email,
                password: pass,
                p_nummer: pnum,
                discord_id: discord,
                rolle: role
            }]);

            if (!error) {
                showToast('Anmodning sendt! Botten opretter kontoen om få sekunder.');
                form.reset();
                setTimeout(loadAdminUsers, 3000);
            } else {
                alert('Fejl: ' + error.message);
            }
        });
    }
}

async function loadAdminUsers() {
    const list = document.getElementById('admin-user-list');
    if (!list) return;
    const { data: users } = await _supabase.from('betjente').select('*').order('navn');
    list.innerHTML = users?.map(u => `
        <div class="lov-item" style="justify-content:space-between;">
            <div>
                <strong>${u.navn}</strong> (${u.p_nummer})<br>
                <span style="font-size:0.8rem; color:var(--police-text-muted);">${u.email}</span>
            </div>
            <span class="badge" style="background:${u.rolle === 'admin' ? 'var(--aks-purple)' : 'var(--police-accent)'}">${u.rolle.toUpperCase()}</span>
        </div>
    `).join('') || 'Ingen brugere fundet.';
}

// ============================================
// SAGS MANAGEMENT (CRUD)
// ============================================
async function loadSager(query = '') {
    const list = document.getElementById('sags-liste');
    if (!list) return;

    let q = _supabase.from('sager').select('*').is('slettet_dato', null).order('oprettet_dato', { ascending: false });
    if (query) q = q.or(`navn.ilike.%${query}%,cpr.ilike.%${query}%`);

    const { data, error } = await q;
    if (error) {
        list.innerHTML = `<div class="error">Fejl ved hentning: ${error.message}</div>`;
        return;
    }

    list.innerHTML = data?.map(s => `
        <div class="stat-card" style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <strong>${s.navn}</strong><br>
                <span style="font-size:0.8rem; color:var(--police-text-muted);">CPR: ${s.cpr} | Status: <span style="color:${s.status === 'aktiv' ? 'var(--success-green)' : 'var(--error-red)'}">${s.status.toUpperCase()}</span></span>
            </div>
            <button class="btn-secondary" onclick="openEditCaseModal('${s.id}')">SE / REDIGER</button>
        </div>
    `).join('') || 'Ingen sager fundet.';
}

function openCreateCaseModal() {
    const form = document.getElementById('case-form');
    if (!form) return;
    form.reset();
    document.getElementById('case-id').value = '';
    document.getElementById('case-modal-title').innerText = 'OPRET NY SAG';
    document.getElementById('case-history').style.display = 'none';
    document.getElementById('delete-case-btn').style.display = 'none';
    document.getElementById('case-modal').style.display = 'flex';
}

async function openEditCaseModal(id) {
    const { data: s, error } = await _supabase.from('sager').select('*').eq('id', id).single();
    if (error || !s) return showToast('Fejl ved hentning af sag.');

    const form = document.getElementById('case-form');
    document.getElementById('case-id').value = s.id;
    document.getElementById('case-name').value = s.navn;
    document.getElementById('case-cpr').value = s.cpr;
    document.getElementById('case-dob').value = s.foedselsdag;
    document.getElementById('case-status').value = s.status;
    document.getElementById('case-desc').value = s.beskrivelse;

    document.getElementById('case-modal-title').innerText = 'SAG: ' + s.navn;
    document.getElementById('case-history').style.display = 'block';
    
    // Vis kun slet-knap til ejer eller admin
    if (isAdmin() || s.oprettet_af === currentSession.user.id) {
        document.getElementById('delete-case-btn').style.display = 'block';
        document.getElementById('delete-case-btn').onclick = () => deleteCase(s.id);
    } else {
        document.getElementById('delete-case-btn').style.display = 'none';
    }

    loadCaseLogs(s.id);
    loadCaseFiles(s.id);
    document.getElementById('case-modal').style.display = 'flex';
}

function closeCaseModal() {
    document.getElementById('case-modal').style.display = 'none';
}

async function loadCaseLogs(sagsId) {
    const container = document.getElementById('case-log-container');
    const { data: logs } = await _supabase.from('sags_logs')
        .select('*')
        .eq('sags_id', sagsId)
        .order('dato', { ascending: false });

    container.innerHTML = logs?.map(l => `
        <div style="font-size:0.8rem; border-left:2px solid var(--police-accent); padding-left:10px; margin-bottom:10px;">
            <div style="color:var(--police-text-muted);">${new Date(l.dato).toLocaleString('da-DK')} - ${l.bruger_navn}</div>
            <div style="font-weight:600;">${l.handling.toUpperCase()}: ${l.beskrivelse || ''}</div>
        </div>
    `).join('') || 'Ingen historik fundet.';
}

document.getElementById('case-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('case-id').value;
    const isUpdate = !!id;

    const caseData = {
        navn: document.getElementById('case-name').value,
        cpr: document.getElementById('case-cpr').value,
        foedselsdag: document.getElementById('case-dob').value,
        status: document.getElementById('case-status').value,
        beskrivelse: document.getElementById('case-desc').value,
        sidst_redigeret_af: currentSession.user.id,
        sidst_redigeret_dato: new Date().toISOString()
    };

    let error;
    if (isUpdate) {
        const { error: err } = await _supabase.from('sager').update(caseData).eq('id', id);
        error = err;
        if (!error) await logAction(id, 'rediger', 'Sagen blev opdateret');
    } else {
        caseData.oprettet_af = currentSession.user.id;
        caseData.oprettet_af_navn = currentProfile.navn;
        const { data: newCase, error: err } = await _supabase.from('sager').insert([caseData]).select().single();
        error = err;
        if (!error) await logAction(newCase.id, 'opret', 'Sagen blev oprettet');
    }

    if (!error) {
        showToast(isUpdate ? 'Sagen er opdateret.' : 'Sagen er oprettet.');
        closeCaseModal();
        loadSager();
        updateStats();
    } else {
        alert('Fejl: ' + error.message);
    }
});

async function deleteCase(id) {
    if (!confirm('Er du sikker på du vil slette denne sag? (Dette arkiverer sagen)')) return;

    const { error } = await _supabase.from('sager').update({ slettet_dato: new Date().toISOString() }).eq('id', id);
    if (!error) {
        await logAction(id, 'slet', 'Sagen blev arkiveret/slettet');
        showToast('Sagen er slettet.');
        closeCaseModal();
        loadSager();
        updateStats();
    } else {
        alert('Fejl ved sletning: ' + error.message);
    }
}

async function logAction(sagsId, handling, beskrivelse) {
    await _supabase.from('sags_logs').insert([{
        sags_id: sagsId,
        bruger_id: currentSession.user.id,
        bruger_navn: currentProfile.navn,
        handling: handling,
        beskrivelse: beskrivelse
    }]);
}

// ============================================
// 🚨 EFTERLYSTE LOGIK (NY v4.0)
// ============================================
async function loadEfterlyste() {
    const grid = document.getElementById('wanted-list-grid');
    if (!grid) return;

    const { data: wanted, error } = await _supabase.from('efterlyste').select('*').order('created_at', { ascending: false });
    if (error) return;

    grid.innerHTML = wanted?.map(p => {
        const dangerClass = p.farlighed == 3 ? 'var(--error-red)' : p.farlighed == 2 ? 'var(--warning-yellow)' : 'var(--police-accent)';
        const dangerBorder = p.farlighed == 3 ? '2px solid var(--error-red)' : '1px solid var(--police-border)';
        
        return `
            <div class="stat-card" style="border-top: 5px solid ${dangerClass}; position:relative; overflow:hidden;">
                <div style="display:flex; gap:15px;">
                    <div style="width:80px; height:80px; border-radius:10px; background:#000; overflow:hidden; border: ${dangerBorder}">
                        <img src="${p.billede_url || 'https://via.placeholder.com/80?text=Ingen+Foto'}" style="width:100%; height:100%; object-fit:cover;">
                    </div>
                    <div style="flex:1;">
                        <h3 style="margin:0; font-size:1.1rem;">${p.navn}</h3>
                        <p style="font-size:0.8rem; color:var(--police-text-muted); margin:5px 0;">${p.grund}</p>
                        <div style="display:flex; align-items:center; gap:5px; margin-top:5px;">
                            ${p.farlighed == 3 ? '<span style="color:var(--error-red); font-weight:900;">⚠️ LIVSFARLIG</span>' : p.farlighed == 2 ? '<span style="color:var(--warning-yellow);">❕ MELLEMTRESEL</span>' : '<span style="color:var(--police-accent);">✓ LAV RISIKO</span>'}
                        </div>
                    </div>
                </div>
                ${isAdmin() ? `<button onclick="deleteWanted('${p.id}')" style="position:absolute; top:10px; right:10px; background:transparent; border:none; color:var(--error-red); cursor:pointer;">&times;</button>` : ''}
            </div>
        `;
    }).join('') || '<div style="grid-column: 1/-1; text-align:center; padding:50px; color:var(--police-text-muted);">Ingen efterlyste i databasen.</div>';
}

function openAddWantedModal() {
    if (!isAdmin()) return showToast('Kun ledelsen kan efterlyse personer.');
    document.getElementById('add-wanted-modal').style.display = 'flex';
}

function closeAddWantedModal() {
    document.getElementById('add-wanted-modal').style.display = 'none';
    document.getElementById('add-wanted-form')?.reset();
}

document.getElementById('add-wanted-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        navn: document.getElementById('wanted-name').value,
        billede_url: document.getElementById('wanted-image').value,
        grund: document.getElementById('wanted-reason').value,
        farlighed: parseInt(document.getElementById('wanted-danger').value)
    };

    const { error } = await _supabase.from('efterlyste').insert([data]);
    if (!error) {
        showToast('Personen er nu efterlyst!');
        closeAddWantedModal();
        loadEfterlyste();
        updateStats();
    } else {
        alert('Fejl: ' + error.message);
    }
});

async function deleteWanted(id) {
    if (!isAdmin()) return;
    if (!confirm('Er efterlysningen klaret? (Sletter fra listen)')) return;
    const { error } = await _supabase.from('efterlyste').delete().eq('id', id);
    if (!error) {
        showToast('Efterlysning fjernet.');
        loadEfterlyste();
        updateStats();
    }
}

// ============================================
// 📁 SAGSARKIV & FILER LOGIK (NY v4.0)
// ============================================
async function loadCaseFiles(sagsId) {
    const container = document.getElementById('case-files-container');
    if (!container) return;

    const { data: files, error } = await _supabase.from('sags_filer').select('*').eq('sags_id', sagsId);
    if (error) return;

    container.innerHTML = files?.map(f => `
        <div style="position:relative; width:100px; height:100px; border-radius:8px; overflow:hidden; border:1px solid var(--police-border);">
            <img src="${f.fil_url}" style="width:100%; height:100%; object-fit:cover; cursor:pointer;" onclick="window.open('${f.fil_url}', '_blank')">
            <button onclick="deleteCaseFile('${f.id}', '${sagsId}')" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.5); border:none; color:white; border-radius:50%; width:20px; height:20px; cursor:pointer;">&times;</button>
        </div>
    `).join('') || '';
}

async function addFileToCase() {
    const sagsId = document.getElementById('case-id').value;
    const filUrl = document.getElementById('case-file-url').value.trim();
    if (!sagsId || !filUrl) return alert('Opret/Gem sagen først, og indtast en gyldig URL.');

    const { error } = await _supabase.from('sags_filer').insert([{
        sags_id: sagsId,
        fil_url: filUrl,
        fil_navn: 'Vedhæftet Fil'
    }]);

    if (!error) {
        showToast('Fil tilføjet til sagen.');
        document.getElementById('case-file-url').value = '';
        loadCaseFiles(sagsId);
    } else {
        alert('Fejl ved tilføjelse: ' + error.message);
    }
}

async function deleteCaseFile(id, sagsId) {
    if (!confirm('Er du sikker på du vil slette dette billede?')) return;
    const { error } = await _supabase.from('sags_filer').delete().eq('id', id);
    if (!error) {
        showToast('Fil fjernet fra sag.');
        loadCaseFiles(sagsId);
    }
}

// ============================================
// HELPERS & LISTENERS
// ============================================
function isAdmin() { return currentProfile?.rolle === 'admin'; }

function showToast(msg) {
    const t = document.getElementById('notif-toast');
    if (t) {
        t.innerText = msg;
        t.style.display = 'block';
        setTimeout(() => { t.style.display = 'none'; }, 4000);
    }
}

// ============================================
// STRAFFEATTEST VIEW (INLINE)
// ============================================
async function viewAttest(discordId) {
    const container = document.getElementById(`attest-inline-${discordId}`);
    if (!container) return;

    // Hvis den allerede er åben, så luk den (Bedre tjek)
    const isVisible = container.style.display === 'block' || window.getComputedStyle(container).display === 'block';
    
    if (isVisible) {
        container.style.display = 'none';
        return;
    }

    // Luk alle andre åbne attester for at holde det rent
    document.querySelectorAll('.attest-inline-container').forEach(c => c.style.display = 'none');
    
    container.innerHTML = '<div class="loading">Henter attest...</div>';
    container.style.display = 'block';

    // Hent borger info
    const { data: borger } = await _supabase.from('borgere').select('*').eq('discord_id', discordId).single();
    if (!borger) {
        container.innerHTML = '<div class="error">Borger ikke fundet.</div>';
        return;
    }

    // Hent alle bøder/sager (som ikke er slettet)
    const { data: boeder } = await _supabase.from('boeder')
        .select('*')
        .or(`user_discord_id.eq.${discordId},user_name.ilike.%${borger.visningsnavn}%`)
        .is('slettet_dato', null)
        .order('created_at', { ascending: false });

    const totalFine = boeder?.reduce((acc, b) => acc + b.amount, 0) || 0;
    const totalJail = boeder?.reduce((acc, b) => acc + (b.jail_days || 0), 0) || 0;

    container.innerHTML = `
        <button class="attest-close-btn" onclick="document.getElementById('attest-inline-${discordId}').style.display='none'">&times;</button>
        
        <div class="attest-inline-header">
            <img src="${borger.billede_url || 'https://via.placeholder.com/100'}" alt="Profil">
            <div>
                <h3 style="margin:0; color:var(--police-accent);">${borger.visningsnavn}</h3>
                <p style="margin:0; font-size:0.8rem; color:var(--police-text-muted);">CPR: ${borger.cpr || 'IKKE OPLYST'}</p>
                <div style="margin-top:5px;">
                    <span class="badge" style="background:rgba(245, 158, 11, 0.1); color:var(--warning-yellow);">TOTAL BØDE: ${totalFine.toLocaleString()} kr.</span>
                    <span class="badge" style="background:rgba(239, 68, 68, 0.1); color:var(--error-red);">FÆNGSEL: ${totalJail} DAGE</span>
                </div>
            </div>
        </div>

        <div class="attest-records" style="max-height:300px; overflow-y:auto; padding-right:5px;">
            ${boeder && boeder.length > 0 ? boeder.map(b => `
                <div class="attest-entry ${!b.afsonet ? 'unpaid' : ''}">
                    <div style="display:flex; justify-content:space-between; font-weight:700; font-size:0.85rem;">
                        <span>⚖️ ${b.paragraf || 'Ukendt Paragraf'}</span>
                        <span style="color:${b.afsonet ? 'var(--success-green)' : 'var(--error-red)'}">${b.afsonet ? '✓ AFSONET' : '⚠ MANGLER'}</span>
                    </div>
                    <div style="font-size:0.8rem; color:var(--police-text-muted); margin:3px 0;">${b.reason || 'Ingen beskrivelse'}</div>
                    <div style="display:flex; justify-content:space-between; font-size:0.75rem; align-items:center; margin-top:5px;">
                        <div>
                            <span>Beløb: ${b.amount.toLocaleString()} kr.</span><br>
                            <span>Dato: ${new Date(b.created_at).toLocaleDateString('da-DK')}</span>
                        </div>
                        ${isAdmin() ? `<button class="btn-secondary" onclick="deleteFine('${b.id}', '${discordId}')" style="background:#ef4444; border-color:#ef4444; font-size:0.7rem; padding:4px 8px;">SLET</button>` : ''}
                    </div>
                </div>
            `).join('') : '<div style="text-align:center; padding:20px; color:var(--police-text-muted);">Ingen tidligere lovovertrædelser fundet.</div>'}
        </div>
    `;
}

async function deleteFine(id, discordId) {
    if (!isAdmin()) return showToast('Kun admins kan slette straffe.');
    if (!confirm('Er du sikker på, at du vil fjerne denne straf fra attesten? (Den arkiveres)')) return;

    try {
        const { error } = await _supabase.from('boeder').update({ slettet_dato: new Date().toISOString() }).eq('id', id);
        if (error) throw error;

        showToast('Straffen er blevet fjernet fra attesten.');
        // Opdater visningen med det samme
        viewAttest(discordId);
    } catch (err) {
        console.error('Fejl ved sletning af bøde:', err);
        alert('Kunne ikke slette: ' + err.message);
    }
}

function setupEventListeners() {
    // Sags-søgning
    document.getElementById('search-input')?.addEventListener('input', (e) => {
        loadSager(e.target.value);
    });

    // Attest-søgning
    document.getElementById('search-attest-input')?.addEventListener('input', (e) => {
        loadStraffeattester(e.target.value);
    });

    // Luk modals ved klik udenfor
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
        }
    });

    // Luk attest modal knap
    document.getElementById('close-attest-modal')?.addEventListener('click', () => {
        document.getElementById('attest-modal').style.display = 'none';
    });
}

document.getElementById('nav-off-duty')?.addEventListener('click', async () => {
    if (confirm('Vil du gå af vagt? Du vil blive fjernet fra flåden.')) {
        await setOffDuty();
        showToast('Du er nu gået af vagt.');
    }
});

document.getElementById('nav-logout')?.addEventListener('click', async () => {
    if (confirm('Vil du afslutte din vagt og logge ud?')) {
        isLoggingOut = true;
        await setOffDuty();
        await _supabase.auth.signOut();
        window.location.href = 'login.html';
    }
});

async function setOffDuty() {
    if (!currentProfile) return;
    await _supabase.from('betjente').update({ 
        is_on_duty: false,
        current_unit: null 
    }).eq('id', currentProfile.id);
    
    currentProfile.is_on_duty = false;
    currentProfile.current_unit = null;
    
    updateUIProfile();
    updateStats();
    updateFleet();
    
    // Vis overlay igen hvis de er gået af vagt
    const overlay = document.getElementById('duty-overlay');
    if (overlay) overlay.style.display = 'flex';
}

window.addEventListener('beforeunload', (e) => {
    if (currentProfile?.is_on_duty && !isLoggingOut) {
        e.preventDefault();
        e.returnValue = 'Du er stadig på vagt!';
    }
});
// ============================================
// PROFILE & PASSWORD
// ============================================
function setupProfileListeners() {
    const form = document.getElementById('change-password-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newPass = document.getElementById('new-password-val').value;
        const confirmPass = document.getElementById('confirm-password-val').value;
        const msg = document.getElementById('profile-msg');

        if (newPass !== confirmPass) {
            msg.innerHTML = '<span style="color:var(--error-red)">Kodeordene er ikke ens!</span>';
            return;
        }

        if (newPass.length < 6) {
            msg.innerHTML = '<span style="color:var(--error-red)">Koden skal være mindst 6 tegn lang.</span>';
            return;
        }

        msg.innerHTML = '<span style="color:var(--police-accent)">Opdaterer kodeord...</span>';
        
        try {
            const { error } = await _supabase.auth.updateUser({ password: newPass });
            if (error) throw error;

            msg.innerHTML = '<span style="color:var(--success-green)">✅ Kodeordet er nu ændret!</span>';
            form.reset();
            setTimeout(closeProfileModal, 3000);
        } catch (err) {
            msg.innerHTML = `<span style="color:var(--error-red)">FEJL: ${err.message}</span>`;
        }
    });
}
