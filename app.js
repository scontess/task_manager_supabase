// --- CONFIGURAZIONE SUPABASE ---

const ENV = window.env; // questo per netlify, che inietta le variabili d'ambiente in window.env
const SUPABASE_URL = ENV.SUPABASE_URL;
const SUPABASE_ANON_KEY = ENV.SUPABASE_ANON_KEY;

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allTasks = [];
let allProfiles = [];
let currentUser = null;
let userRole = 'user'; 
let userCompanyId = null; 
let allUsersMap = {}; 

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await _supabase.auth.getSession();
    handleSession(session);

    _supabase.auth.onAuthStateChange((event, session) => {
        handleSession(session);
    });

    setupSelectColorToggle('new-task-status');
    setupSelectColorToggle('new-task-assignee');
});

function setupSelectColorToggle(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.addEventListener('change', function() {
        if (this.value) {
            this.classList.remove('text-gray-500');
            this.classList.add('text-gray-800');
        } else {
            this.classList.remove('text-gray-800');
            this.classList.add('text-gray-500');
        }
    });
}

// --- GESTIONE SESSIONE & PROFILO MULTI-TENANT ---
async function handleSession(session) {
    const authContainer = document.getElementById('auth-container');
    const appContainer = document.getElementById('app-container');
    const btnCreateUser = document.getElementById('btn-open-create-user');

    if (!session) {
        currentUser = null;
        userRole = 'user';
        userCompanyId = null;
        if (authContainer) authContainer.classList.remove('hidden');
        if (appContainer) appContainer.classList.add('hidden');
        if (btnCreateUser) btnCreateUser.classList.add('hidden');
        return;
    }

    currentUser = session.user;
    if (authContainer) authContainer.classList.add('hidden');
    if (appContainer) appContainer.classList.remove('hidden');

    await fetchUserProfile();

    const nameDisplay = document.getElementById('user-name-display');
    if (nameDisplay) nameDisplay.innerText = allUsersMap[currentUser.id] || currentUser.email;
    
    const badge = document.getElementById('user-role-badge');
    if (badge) {
        badge.innerText = userRole.toUpperCase();
        badge.className = `inline-block px-2 py-0.5 text-xs font-semibold rounded-full mt-0.5 ${userRole === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`;
    }

    if (btnCreateUser) {
        if (userRole === 'admin') {
            btnCreateUser.classList.remove('hidden');
        } else {
            btnCreateUser.classList.add('hidden');
        }
    }

    const adminFieldsContainer = document.getElementById('admin-task-fields');
    const adminFiltersContainer = document.getElementById('admin-filters-container');
    const adminUsersSection = document.getElementById('admin-users-section');

    if (userRole === 'admin') {
        if (adminFieldsContainer) adminFieldsContainer.classList.remove('hidden');
        if (adminFiltersContainer) adminFiltersContainer.classList.remove('hidden');
        if (adminUsersSection) adminUsersSection.classList.remove('hidden');
        populateNewTaskAssigneeDropdown();
        populateAdminFilterAssignees();
    } else {
        if (adminFieldsContainer) adminFieldsContainer.classList.add('hidden');
        if (adminFiltersContainer) adminFiltersContainer.classList.add('hidden');
        if (adminUsersSection) adminUsersSection.classList.add('hidden');
    }

    loadData();
}

async function fetchUserProfile() {
    const { data: myProfile, error } = await _supabase
        .from('profiles')
        .select('role, company_id, name')
        .eq('id', currentUser.id)
        .single();

    if (!error && myProfile) {
        userRole = myProfile.role;
        userCompanyId = myProfile.company_id;
    }
}

// --- LOGIN & LOGOUT ---
async function handleLogin() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();

    if (!email || !password) {
        showToast('Inserisci email e password', 'error');
        return;
    }

    const { error } = await _supabase.auth.signInWithPassword({ email, password });
    if (error) {
        showToast('Credenziali non valide', 'error');
        console.error("Errore login:", error.message); // Utile per vedere eventuali dettagli in console (F12)
        return;
    }

    showToast('Login effettuato con successo!');
    
    // AGGIUNGI QUESTO: Ricarica i dati e aggiorna la schermata principale
    if (typeof loadData === 'function') {
        loadData();
    }
}

async function handleSignup() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();

    if (!email || !password) {
        showToast('Inserisci email e password', 'error');
        return;
    }

    const { data, error } = await _supabase.auth.signUp({ email, password });
    if (error) {
        showToast('Errore durante la registrazione', 'error');
        return;
    }

    if (data && data.user) {
        await _supabase.from('profiles').upsert({
            id: data.user.id,
            email: email,
            name: email.split('@')[0],
            role: 'user'
        });
    }

    showToast('Registrazione avvenuta con successo!');
}

async function handleLogout() {
    await _supabase.auth.signOut();
    
    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';

    showToast('Logout effettuato');
}

// --- GESTIONE MODALE CREAZIONE UTENTE (Tramite RPC) ---
function openCreateUserModal() {
    document.getElementById('new-user-name').value = '';
    document.getElementById('new-user-email').value = '';
    document.getElementById('new-user-password').value = '';
    document.getElementById('create-user-modal').classList.remove('hidden');
}

function closeCreateUserModal() {
    document.getElementById('create-user-modal').classList.add('hidden');
}

async function handleAdminCreateUser() {
    const name = document.getElementById('new-user-name').value.trim();
    const email = document.getElementById('new-user-email').value.trim().toLowerCase();
    const password = document.getElementById('new-user-password').value.trim();
    const role = document.getElementById('new-user-role').value;

    if (!name || !email || !password) {
        showToast('Compila tutti i campi obbligatori', 'error');
        return;
    }

    // 1. Recupera la company_id dell'admin corrente
    const { data: adminProfile, error: adminError } = await _supabase
        .from('profiles')
        .select('company_id')
        .eq('id', currentUser.id)
        .single();

    const companyId = adminProfile ? adminProfile.company_id : null;

    if (!companyId) {
        showToast('Errore: Impossibile determinare l’azienda dell’admin', 'error');
        return;
    }

    // 2. Crea l'utente tramite il sistema nativo di Supabase Auth
    const { data: authData, error: authError } = await _supabase.auth.signUp({
        email: email,
        password: password,
        options: {
            data: { name: name }
        }
    });

    if (authError) {
        showToast('Errore Auth: ' + authError.message, 'error');
        return;
    }

    const userId = authData.user?.id;
    if (!userId) {
        showToast('Errore: ID utente non generato', 'error');
        return;
    }

    // 3. Inserisce o aggiorna il record nella tabella profiles associando la company_id
    const { error: profileError } = await _supabase
        .from('profiles')
        .upsert({
            id: userId,
            email: email,
            name: name,
            role: role,
            company_id: companyId
        });

    if (profileError) {
        showToast('Errore salvataggio profilo: ' + profileError.message, 'error');
        return;
    }

    showToast('Nuovo utente creato con successo!');
    closeCreateUserModal();
    loadData();
}

// --- GESTIONE MODALE MODIFICA UTENTE ---
function openEditUserModal(userId) {
    const profile = allProfiles.find(p => p.id === userId);
    if (!profile) return;

    document.getElementById('edit-user-id').value = profile.id;
    document.getElementById('edit-user-name').value = profile.name || '';
    document.getElementById('edit-user-role').value = profile.role || 'user';
    document.getElementById('edit-user-modal').classList.remove('hidden');
}

function closeEditUserModal() {
    document.getElementById('edit-user-modal').classList.add('hidden');
}

async function handleUpdateUser() {
    const userId = document.getElementById('edit-user-id').value;
    const name = document.getElementById('edit-user-name').value.trim();
    const role = document.getElementById('edit-user-role').value;

    if (!name) {
        showToast('Il nome non può essere vuoto', 'error');
        return;
    }

    // Chiamata alla funzione RPC sul backend di Supabase
    const { data, error } = await _supabase.rpc('admin_update_user', {
        p_user_id: userId,
        p_name: name,
        p_role: role
    });

    if (error) {
        showToast('Errore durante l’aggiornamento utente: ' + error.message, 'error');
        console.error(error);
        return;
    }

    showToast('Utente aggiornato con successo!');
    closeEditUserModal();
    loadData();
}

async function deleteUser(userId) {
    if (userId === currentUser.id) {
        showToast('Non puoi eliminare il tuo account attivo', 'error');
        return;
    }
    if (!confirm('Sei sicuro di voler eliminare questo utente?')) return;

    // Chiamata alla funzione RPC sul backend di Supabase
    const { data, error } = await _supabase.rpc('admin_delete_user', {
        p_user_id: userId
    });

    if (error) {
        showToast('Errore durante l’eliminazione: ' + error.message, 'error');
        console.error(error);
        return;
    }

    showToast('Utente eliminato con successo');
    loadData();
}

// --- CARICAMENTO DATI ---
async function loadData() {
    if (!userCompanyId) return;

    const { data: profilesData } = await _supabase
        .from('profiles')
        .select('id, name, email, role')
        .eq('company_id', userCompanyId);

    if (profilesData) {
        allProfiles = profilesData;
        allUsersMap = {};
        profilesData.forEach(p => {
            allUsersMap[p.id] = p.name || p.email;
        });
        if (userRole === 'admin') {
            populateNewTaskAssigneeDropdown();
            populateAdminFilterAssignees();
            renderUsersTable(profilesData);
        }
    }

    const { data: tasksData, error } = await _supabase
        .from('tasks')
        .select('*')
        .eq('company_id', userCompanyId)
        .order('created_at', { ascending: false });

    if (error) {
        showToast('Errore nel caricamento dei task', 'error');
        return;
    }

    allTasks = tasksData || [];
    filterTasks();
}

function getActiveUsersList() {
    return Object.keys(allUsersMap).map(id => ({
        id: id,
        name: allUsersMap[id]
    }));
}

function populateNewTaskAssigneeDropdown() {
    const select = document.getElementById('new-task-assignee');
    if (!select) return;

    const usersList = getActiveUsersList();
    let options = `<option value="" disabled selected>Seleziona assegnatario</option>`;
    
    usersList.forEach(u => {
        options += `<option value="${u.id}">${u.name}</option>`;
    });

    select.innerHTML = options;
}

function populateAdminFilterAssignees() {
    const select = document.getElementById('filter-assignee');
    if (!select) return;

    const usersList = getActiveUsersList();
    let options = `<option value="ALL">Tutti gli assegnatari</option>`;
    options += `<option value="UNASSIGNED">-- Non assegnati --</option>`;
    
    usersList.forEach(u => {
        options += `<option value="${u.id}">${u.name}</option>`;
    });

    select.innerHTML = options;
}

// --- RENDER TABELLA UTENTI (Admin) ---
function renderUsersTable(profiles) {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (profiles.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-gray-400">Nessun utente trovato</td></tr>`;
        return;
    }

    profiles.forEach(p => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50/50 transition border-b border-gray-50 last:border-none';

        const roleBadge = p.role === 'admin'
            ? `<span class="px-2 py-0.5 text-xs font-semibold bg-purple-100 text-purple-700 rounded-full">Admin</span>`
            : `<span class="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 rounded-full">User</span>`;

        tr.innerHTML = `
            <td class="p-3 pl-4 font-medium text-gray-900">${escapeHtml(p.name || '-')}</td>
            <td class="p-3 text-gray-600">${escapeHtml(p.email)}</td>
            <td class="p-3">${roleBadge}</td>
            <td class="p-3 pr-4 text-right">
                <div class="flex items-center justify-end gap-1">
                    <button onclick="openEditUserModal('${p.id}')" title="Modifica utente" class="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                    </button>
                    <button onclick="deleteUser('${p.id}')" title="Elimina utente" class="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- DISEGNA LA TABELLA TASK ---
function renderTable(tasks) {
    const tbody = document.getElementById('task-table-body');
    const counter = document.getElementById('task-counter');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (counter) counter.innerText = `Totale task visibili: ${tasks.length}`;

    if (tasks.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-gray-400">Nessuna attività trovata</td></tr>`;
        return;
    }

    const isAdmin = userRole === 'admin';
    const usersList = getActiveUsersList();

    tasks.forEach(task => {
        if (!isAdmin && task.assigned_to !== currentUser.id) {
            return;
        }

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50/50 transition border-b border-gray-50 last:border-none';
        
        const formattedDate = task.created_at ? new Date(task.created_at).toLocaleDateString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : '-';

        const authorName = allUsersMap[task.user_id] || task.user_email || 'Sconosciuto';
        const assignedName = allUsersMap[task.assigned_to] || 'Non assegnato';

        const statusBadge = task.status === 'Evaso' 
            ? `<span class="px-2.5 py-1 text-xs font-medium bg-green-50 text-green-700 rounded-full border border-green-200">Evaso</span>`
            : `<span class="px-2.5 py-1 text-xs font-medium bg-amber-50 text-amber-700 rounded-full border border-amber-200">Attivo</span>`;

        let assignOptions = `<option value="">-- Non assegnato --</option>`;
        usersList.forEach(u => {
            const selected = task.assigned_to === u.id ? 'selected' : '';
            assignOptions += `<option value="${u.id}" ${selected}>${u.name}</option>`;
        });

        tr.innerHTML = `
            <td class="p-4 pl-6 font-semibold text-gray-900">${escapeHtml(task.task_name)}</td>
            <td class="p-4 text-gray-600 max-w-xs truncate">${escapeHtml(task.task_desc || '-')}</td>
            <td class="p-4">
                ${isAdmin ? `
                    <div class="text-xs space-y-1">
                        <span class="text-gray-500 block">Da: <strong class="text-gray-700">${escapeHtml(authorName)}</strong></span>
                        <select onchange="updateTaskAssignment('${task.id}', this.value)" class="border border-gray-200 rounded-lg p-1 text-xs bg-white font-medium text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none transition w-full">
                            ${assignOptions}
                        </select>
                    </div>
                ` : `
                    <div class="text-xs text-gray-600 space-y-0.5">
                        <span class="block">Creato da: <strong class="text-gray-700">${escapeHtml(authorName)}</strong></span>
                        <span class="text-blue-600 font-medium block">Assegnato a: ${escapeHtml(assignedName)}</span>
                    </div>
                `}
            </td>
            <td class="p-4">
                ${isAdmin ? `
                    <select onchange="updateTaskField('${task.id}', 'status', this.value)" class="border border-gray-200 rounded-lg p-1.5 text-xs bg-white font-medium text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none transition">
                        <option value="Attivo" ${task.status === 'Attivo' ? 'selected' : ''}>Attivo</option>
                        <option value="Evaso" ${task.status === 'Evaso' ? 'selected' : ''}>Evaso</option>
                    </select>
                ` : statusBadge}
            </td>
            <td class="p-4 text-center">
                <input type="checkbox" ${task.eseguito ? 'checked' : ''} onchange="updateTaskField('${task.id}', 'eseguito', this.checked)" class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer">
            </td>
            <td class="p-4 text-xs text-gray-400">${formattedDate}</td>
            <td class="p-4 pr-6 text-right">
                ${isAdmin ? `
                    <div class="flex items-center justify-end gap-1">
                        <button onclick="openEditModal('${task.id}')" title="Modifica task" class="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                        </button>
                        <button onclick="deleteTask('${task.id}')" title="Elimina task" class="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                    </div>
                ` : `<span class="text-xs text-gray-300">Sola lettura</span>`}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filterTasks() {
    const searchInput = document.getElementById('search-input');
    const statusFilter = document.getElementById('status-filter');
    const filterAssignee = document.getElementById('filter-assignee');
    const filterEseguito = document.getElementById('filter-eseguito');
    
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
    const statusValue = statusFilter ? statusFilter.value : 'ALL';
    const assigneeValue = filterAssignee ? filterAssignee.value : 'ALL';
    const eseguitoValue = filterEseguito ? filterEseguito.value : 'ALL';

    const filtered = allTasks.filter(task => {
        const nameMatch = task.task_name && task.task_name.toLowerCase().includes(searchTerm);
        const descMatch = task.task_desc && task.task_desc.toLowerCase().includes(searchTerm);
        const matchesSearch = nameMatch || descMatch;

        const matchesStatus = statusValue === 'ALL' || task.status === statusValue;

        let matchesAssignee = true;
        if (userRole === 'admin' && assigneeValue !== 'ALL') {
            if (assigneeValue === 'UNASSIGNED') {
                matchesAssignee = !task.assigned_to;
            } else {
                matchesAssignee = task.assigned_to === assigneeValue;
            }
        }

        let matchesEseguito = true;
        if (userRole === 'admin' && eseguitoValue !== 'ALL') {
            const isCompleted = eseguitoValue === 'true';
            matchesEseguito = Boolean(task.eseguito) === isCompleted;
        }

        return matchesSearch && matchesStatus && matchesAssignee && matchesEseguito;
    });

    renderTable(filtered);
}

// --- AGGIUNGI TASK ---
async function handleAddTask() {
    const nameInput = document.getElementById('task-name');
    const descInput = document.getElementById('task-desc');
    const statusInput = document.getElementById('new-task-status');
    const assigneeInput = document.getElementById('new-task-assignee');

    const taskName = nameInput.value.trim();
    const taskDesc = descInput.value.trim();

    if (!taskName) {
        showToast('Inserisci il titolo del task', 'error');
        return;
    }

    const taskStatus = (userRole === 'admin' && statusInput && statusInput.value) ? statusInput.value : 'Attivo';
    const assignedTo = (userRole === 'admin' && assigneeInput && assigneeInput.value) 
        ? assigneeInput.value 
        : currentUser.id;

    const { error } = await _supabase
        .from('tasks')
        .insert([{ 
            task_name: taskName, 
            task_desc: taskDesc, 
            status: taskStatus,
            company_id: userCompanyId, 
            user_id: currentUser.id,
            user_email: currentUser.email,
            assigned_to: assignedTo,
            eseguito: false
        }]);

    if (error) {
        showToast('Errore durante il salvataggio', 'error');
        console.error(error);
        return;
    }

    showToast('Task aggiunto con successo!');
    nameInput.value = '';
    descInput.value = '';
    
    if (userRole === 'admin') {
        if (statusInput) {
            statusInput.value = "";
            statusInput.classList.remove('text-gray-800');
            statusInput.classList.add('text-gray-500');
        }
        if (assigneeInput) {
            assigneeInput.value = "";
            assigneeInput.classList.remove('text-gray-800');
            assigneeInput.classList.add('text-gray-500');
        }
    }

    loadData();
}

// --- MODIFICA TASK COMPLETA (MODALE) ---
function openEditModal(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    document.getElementById('edit-task-id').value = task.id;
    document.getElementById('edit-task-name').value = task.task_name || '';
    document.getElementById('edit-task-desc').value = task.task_desc || '';
    document.getElementById('edit-task-status').value = task.status || 'Attivo';

    const selectAssignee = document.getElementById('edit-task-assignee');
    const usersList = getActiveUsersList();
    let options = `<option value="">-- Non assegnato --</option>`;
    usersList.forEach(u => {
        const selected = task.assigned_to === u.id ? 'selected' : '';
        options += `<option value="${u.id}" ${selected}>${u.name}</option>`;
    });
    selectAssignee.innerHTML = options;

    document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden');
}

async function handleUpdateTask() {
    const taskId = document.getElementById('edit-task-id').value;
    const taskName = document.getElementById('edit-task-name').value.trim();
    const taskDesc = document.getElementById('edit-task-desc').value.trim();
    const status = document.getElementById('edit-task-status').value;
    const assignee = document.getElementById('edit-task-assignee').value || null;

    if (!taskName) {
        showToast('Il titolo non può essere vuoto', 'error');
        return;
    }

    const { error } = await _supabase
        .from('tasks')
        .update({
            task_name: taskName,
            task_desc: taskDesc,
            status: status,
            assigned_to: assignee
        })
        .eq('id', taskId);

    if (error) {
        showToast('Errore durante l’aggiornamento', 'error');
        return;
    }

    showToast('Task modificato con successo!');
    closeEditModal();
    loadData();
}

async function updateTaskAssignment(id, assignedUserId) {
    const valueToSave = assignedUserId === "" ? null : assignedUserId;
    const { error } = await _supabase.from('tasks').update({ assigned_to: valueToSave }).eq('id', id);
    if (error) {
        showToast('Errore assegnazione', 'error');
        return;
    }
    showToast('Task riassegnato!');
    loadData();
}

async function updateTaskField(id, fieldName, value) {
    const payload = {}; payload[fieldName] = value;
    const { error } = await _supabase.from('tasks').update(payload).eq('id', id);
    if (error) {
        showToast('Errore aggiornamento', 'error');
        return;
    }
    showToast('Aggiornato con successo!');
    loadData();
}

async function deleteTask(id) {
    if (!confirm('Sei sicuro di voler eliminare questo task?')) return;
    const { error } = await _supabase.from('tasks').delete().eq('id', id);
    if (error) {
        showToast('Errore durante l’eliminazione', 'error');
        return;
    }
    showToast('Task eliminato');
    loadData();
}

// --- NOTIFICHE TOAST ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-emerald-600' : 'bg-rose-600';
    
    toast.className = `${bgColor} text-white px-4 py-3 rounded-xl shadow-lg text-sm transition-all duration-300 opacity-0 transform translate-y-2 flex items-center gap-2`;
    toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
    
    container.appendChild(toast);
    setTimeout(() => toast.classList.remove('opacity-0', 'translate-y-2'), 10);
    
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}