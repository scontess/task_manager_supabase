// --- CONFIGURAZIONE SUPABASE ---
const ENV = window.env; // Mette in comunicazione ENV con window.env di Netlify, nb per farlo andare in locale commenta questa stringa


const SUPABASE_URL = ENV.SUPABASE_URL;
const SUPABASE_ANON_KEY = ENV.SUPABASE_ANON_KEY;

// --- CONFIGURAZIONE DUALE sia locale che Netlify ---
/*const SUPABASE_URL = (window.env && window.env.SUPABASE_URL) || NOME_VARIABILE_DEL_TUO_ENV_CONFIG_LOCALE;
const SUPABASE_ANON_KEY = (window.env && window.env.SUPABASE_ANON_KEY) || ALTRA_VARIABILE_DEL_TUO_ENV_CONFIG_LOCALE;*/



const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Variabili di stato globale
let allTasks = [];
let currentUser = null;
let userRole = 'user'; 
let allUsersMap = {}; // Mappa per associare l'ID utente alla sua email

// All'avvio verifica se c'è una sessione attiva
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await _supabase.auth.getSession();
    handleSession(session);

    // Ascolta i cambiamenti di autenticazione in tempo reale
    _supabase.auth.onAuthStateChange((event, session) => {
        handleSession(session);
    });
});

// --- GESTIONE SESSIONE & UI ---
async function handleSession(session) {
    const authContainer = document.getElementById('auth-container');
    const appContainer = document.getElementById('app-container');

    if (!session) {
        currentUser = null;
        userRole = 'user';
        if (authContainer) authContainer.classList.remove('hidden');
        if (appContainer) appContainer.classList.add('hidden');
        return;
    }

    currentUser = session.user;
    if (authContainer) authContainer.classList.add('hidden');
    if (appContainer) appContainer.classList.remove('hidden');

    // Recupera il ruolo reale dalla tabella 'profiles'
    await fetchUserRole();

    // Mostra info utente in alto
    const emailDisplay = document.getElementById('user-email-display');
    if (emailDisplay) emailDisplay.innerText = currentUser.email;
    
    const badge = document.getElementById('user-role-badge');
    if (badge) {
        badge.innerText = userRole.toUpperCase();
        badge.className = `inline-block px-2 py-0.5 text-xs font-semibold rounded-full mt-0.5 ${userRole === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`;
    }

    loadTasks();
}

async function fetchUserRole() {
    const { data, error } = await _supabase
        .from('profiles')
        .select('role')
        .eq('id', currentUser.id)
        .single();

    if (!error && data) {
        userRole = data.role;
    }
}

// --- LOGIN, REGISTRAZIONE & LOGOUT ---
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
        console.error(error);
        return;
    }
    showToast('Login effettuato con successo!');
}

async function handleSignup() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();

    if (!email || !password) {
        showToast('Inserisci email e password', 'error');
        return;
    }

    const { error } = await _supabase.auth.signUp({ email, password });
    if (error) {
        showToast('Errore durante la registrazione', 'error');
        console.error(error);
        return;
    }
    showToast('Registrazione avvenuta con successo!');
}

async function handleLogout() {
    await _supabase.auth.signOut();
    showToast('Logout effettuato');
}

// --- SISTEMA DI NOTIFICHE TOAST ---
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

// --- CARICAMENTO DATI (Task + Profili Utenti) ---
async function loadTasks() {
    // 1. Carica i profili utenti per mappare gli ID alle email
    const { data: profilesData } = await _supabase.from('profiles').select('id, email');
    if (profilesData) {
        allUsersMap = {};
        profilesData.forEach(p => {
            allUsersMap[p.id] = p.email;
        });
    }

    // 2. Carica i task
    const { data, error } = await _supabase
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        showToast('Errore nel caricamento dei task', 'error');
        console.error(error);
        return;
    }

    allTasks = data || [];
    filterTasks();
}

// Estrae la lista degli utenti per popolare i menu a tendina
function getActiveUsersList() {
    return Object.keys(allUsersMap).map(id => ({
        id: id,
        email: allUsersMap[id]
    }));
}

// --- DISEGNA LA TABELLA ---
function renderTable(tasks) {
    const tbody = document.getElementById('task-table-body');
    const counter = document.getElementById('task-counter');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (counter) counter.innerText = `Totale task visibili: ${tasks.length}`;

    if (tasks.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-gray-400">Nessuna attività trovata</td></tr>`;
        return;
    }

    const isAdmin = userRole === 'admin';
    const usersList = getActiveUsersList();

    tasks.forEach(task => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50/50 transition border-b border-gray-50 last:border-none';
        
        const formattedDate = task.created_at ? new Date(task.created_at).toLocaleDateString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : '-';

        const authorEmail = allUsersMap[task.user_id] || 'Utente sconosciuto';
        const assignedEmail = allUsersMap[task.assigned_to] || 'Non assegnato';

        const statusBadge = task.status === 'Evaso' 
            ? `<span class="px-2.5 py-1 text-xs font-medium bg-green-50 text-green-700 rounded-full border border-green-200">Evaso</span>`
            : `<span class="px-2.5 py-1 text-xs font-medium bg-amber-50 text-amber-700 rounded-full border border-amber-200">Attivo</span>`;

        // Genera le opzioni per il menu a tendina dell'assegnazione (per l'admin)
        let assignOptions = `<option value="">-- Non assegnato --</option>`;
        usersList.forEach(u => {
            const selected = task.assigned_to === u.id ? 'selected' : '';
            assignOptions += `<option value="${u.id}" ${selected}>${u.email}</option>`;
        });

        tr.innerHTML = `
            <td class="p-4 pl-6 font-semibold text-gray-900">${escapeHtml(task.task_name)}</td>
            <td class="p-4 text-gray-600 max-w-xs truncate">${escapeHtml(task.task_desc || '-')}</td>
            <td class="p-4">
                ${isAdmin ? `
                    <div class="text-xs space-y-1">
                        <span class="text-gray-500 block">Da: <strong class="text-gray-700">${escapeHtml(authorEmail)}</strong></span>
                        <select onchange="updateTaskAssignment('${task.id}', this.value)" class="border border-gray-200 rounded-lg p-1 text-xs bg-white font-medium text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none transition w-full">
                            ${assignOptions}
                        </select>
                    </div>
                ` : `
                    <div class="text-xs text-gray-600 space-y-0.5">
                        <span class="block">Creato da: <strong class="text-gray-700">${escapeHtml(authorEmail)}</strong></span>${task.assigned_to === currentUser.id && task.user_id !== currentUser.id ? 
                            `<span class="text-blue-600 font-medium block">Assegnato a te</span>` : 
                            (task.assigned_to ? `<span class="text-gray-400 block">Assegnato a: ${escapeHtml(assignedEmail)}</span>` : '')
                        }
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
            <td class="p-4 text-xs text-gray-400">${formattedDate}</td>
            <td class="p-4 pr-6 text-right">
                ${isAdmin ? `
                    <button onclick="deleteTask('${task.id}')" class="text-rose-500 hover:text-rose-700 text-xs font-medium px-2.5 py-1.5 rounded-lg hover:bg-rose-50 transition">Elimina</button>
                ` : `<span class="text-xs text-gray-300">Sola lettura</span>`}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- FILTRI E RICERCA ISTANEA ---
function filterTasks() {
    const searchInput = document.getElementById('search-input');
    const statusFilter = document.getElementById('status-filter');
    
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
    const statusValue = statusFilter ? statusFilter.value : 'ALL';

    const filtered = allTasks.filter(task => {
        const nameMatch = task.task_name && task.task_name.toLowerCase().includes(searchTerm);
        const descMatch = task.task_desc && task.task_desc.toLowerCase().includes(searchTerm);
        const matchesSearch = nameMatch || descMatch;
        const matchesStatus = statusValue === 'ALL' || task.status === statusValue;
        return matchesSearch && matchesStatus;
    });

    renderTable(filtered);
}

// --- AGGIUNGI TASK ---
async function handleAddTask() {
    const nameInput = document.getElementById('task-name');
    const descInput = document.getElementById('task-desc');

    const taskName = nameInput.value.trim();
    const taskDesc = descInput.value.trim();

    if (!taskName) {
        showToast('Inserisci il titolo del task', 'error');
        return;
    }

    const { error } = await _supabase
        .from('tasks')
        .insert([{ 
            task_name: taskName, 
            task_desc: taskDesc, 
            status: 'Attivo',
            user_id: currentUser.id,
            assigned_to: currentUser.id // Assegnato di default a chi lo crea
        }]);

    if (error) {
        showToast('Errore durante il salvataggio', 'error');
        console.error(error);
        return;
    }

    showToast('Task aggiunto con successo!');
    nameInput.value = '';
    descInput.value = '';
    loadTasks();
}

// --- AGGIORNA ASSEGNAZIONE TASK ---
async function updateTaskAssignment(id, assignedUserId) {
    const valueToSave = assignedUserId === "" ? null : assignedUserId;
    
    const { error } = await _supabase
        .from('tasks')
        .update({ assigned_to: valueToSave })
        .eq('id', id);

    if (error) {
        showToast('Errore durante l’assegnazione', 'error');
        console.error(error);
        return;
    }

    showToast('Task riassegnato con successo!');
    const task = allTasks.find(t => t.id === id);
    if (task) task.assigned_to = valueToSave;
}

// --- AGGIORNA STATO O ALTRI CAMPI SINGOLI ---
async function updateTaskField(id, fieldName, value) {
    const updatePayload = {};
    updatePayload[fieldName] = value;

    const { error } = await _supabase
        .from('tasks')
        .update(updatePayload)
        .eq('id', id);

    if (error) {
        showToast('Errore aggiornamento', 'error');
        console.error(error);
        return;
    }

    showToast('Aggiornato con successo!');
    const task = allTasks.find(t => t.id === id);
    if (task) task[fieldName] = value;
}

// --- ELIMINA TASK ---
async function deleteTask(id) {
    if (!confirm('Sei sicuro di voler eliminare definitivamente questo task?')) return;

    const { error } = await _supabase
        .from('tasks')
        .delete()
        .eq('id', id);

    if (error) {
        showToast('Errore durante l’eliminazione (permessi negati?)', 'error');
        console.error(error);
        return;
    }

    showToast('Task eliminato con successo');
    loadTasks();
}

// Utility di sicurezza per sanitizzare le stringhe HTML
function escapeHtml(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}