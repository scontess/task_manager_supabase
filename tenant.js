// --- CONFIGURAZIONE SUPABASE ISOLATA ---

const ENV = window.env;

const SUPABASE_URL = ENV.SUPABASE_URL;
const SUPABASE_ANON_KEY = ENV.SUPABASE_ANON_KEY;

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) {
        window.location.href = 'index.html'; 
        return;
    }

    // Verifica che sia un superadmin
    const { data: profile } = await _supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();

    if (!profile || profile.role !== 'superadmin') {
        alert('Accesso negato: Area riservata ai Superuser.');
        window.location.href = 'index.html';
        return;
    }

    // Carica la lista delle aziende all'avvio
    loadCompanies();
});

// --- FUNZIONE PER CARICARE LE AZIENDE NELLA TABELLA ---
// --- FUNZIONE PER CARICARE LE AZIENDE NELLA TABELLA ---
async function loadCompanies() {
    const tbody = document.getElementById('companies-table-body');
    if (!tbody) return;

    // Sostituisci 'companies' con il nome esatto della tua tabella delle aziende nel DB se è diverso
    const { data: companies, error } = await _supabase
        .from('companies')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Errore caricamento aziende:', error);
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-rose-500">Errore nel caricamento dei dati</td></tr>`;
        return;
    }

    if (!companies || companies.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-gray-400">Nessuna azienda registrata</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    companies.forEach(company => {
        const dateFormatted = company.created_at ? new Date(company.created_at).toLocaleDateString('it-IT') : '-';
        const isActive = company.is_active !== false; // Di default è attivo se null/true
        
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition';
        tr.innerHTML = `
            <td class="p-3 pl-4 font-medium text-gray-800">${company.name || '-'}</td>
            <td class="p-3 text-xs text-gray-400 font-mono">${company.id}</td>
            <td class="p-3 text-gray-500">${dateFormatted}</td>
            <td class="p-3 pr-4 text-right">
                <label class="inline-flex items-center cursor-pointer">
                    <span class="text-xs text-gray-500 mr-2">${isActive ? 'Attiva' : 'Bloccata'}</span>
                    <input type="checkbox" ${isActive ? 'checked' : ''} 
                           onchange="toggleCompanyStatus('${company.id}', this.checked)" 
                           class="sr-only peer">
                    <div class="relative w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-600"></div>
                </label>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function handleCreateTenant() {
    const companyName = document.getElementById('tenant-company-name').value.trim();
    const adminName = document.getElementById('tenant-admin-name').value.trim();
    const adminEmail = document.getElementById('tenant-admin-email').value.trim().toLowerCase();
    const adminPassword = document.getElementById('tenant-admin-password').value.trim();

    if (!companyName || !adminName || !adminEmail || !adminPassword) {
        showToast('Compila tutti i campi obbligatori', 'error');
        return;
    }

    const { data, error } = await _supabase.rpc('super_create_company_and_admin', {
        p_company_name: companyName,
        p_admin_email: adminEmail,
        p_admin_password: adminPassword,
        p_admin_name: adminName
    });

    if (error) {
        showToast('Errore creazione tenant: ' + error.message, 'error');
        console.error(error);
        return;
    }

    showToast('Azienda e Amministratore creati con successo!');
    
    // Pulisci i campi
    document.getElementById('tenant-company-name').value = '';
    document.getElementById('tenant-admin-name').value = '';
    document.getElementById('tenant-admin-email').value = '';
    document.getElementById('tenant-admin-password').value = '';

    // Ricarica la tabella delle aziende in tempo reale
    loadCompanies();
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-emerald-600' : 'bg-rose-600';
    
    toast.className = `${bgColor} text-white px-4 py-3 rounded-xl shadow-lg text-sm transition-all duration-300`;
    toast.textContent = message;
    
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

async function handleLogout() {
    const { error } = await _supabase.auth.signOut();
    if (error) {
        showToast('Errore durante il logout', 'error');
        console.error(error);
        return;
    }
    // Reindirizza alla pagina di login principale
    window.location.href = 'index.html';
}

async function toggleCompanyStatus(companyId, isActive) {
    const { error } = await _supabase
        .from('companies')
        .update({ is_active: isActive })
        .eq('id', companyId);

    if (error) {
        showToast('Errore durante l\'aggiornamento dello stato', 'error');
        console.error(error);
        loadCompanies(); // Ricarica per ripristinare lo stato grafico in caso di errore
        return;
    }

    showToast(isActive ? 'Azienda riattivata con successo' : 'Azienda bloccata con successo', isActive ? 'success' : 'error');
}