// ===== Utility Functions =====
var $ = function(id) { return document.getElementById(id); };

function formatCurrency(amount) {
    return 'MVR ' + parseFloat(amount).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}

function formatDateInput(dateStr) {
    if (!dateStr) return '';
    return dateStr.split('T')[0];
}

function todayStr() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
}

function showToast(message, type) {
    type = type || 'success';
    var toast = $('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type + ' show';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() {
        toast.classList.remove('show');
    }, 3000);
}

function loadingHTML() {
    return '<div class="loading"><i class="fas fa-spinner fa-pulse"></i> Loading...</div>';
}

function emptyHTML(msg) {
    msg = msg || 'No transactions found.';
    return '<div class="empty-state"><i class="fas fa-inbox"></i><p>' + msg + '</p></div>';
}

// ===== API Calls =====
function api(url, method, data, cb) {
    var opts = {
        method: method || 'GET',
        headers: { 'Content-Type': 'application/json' }
    };
    if (data) opts.body = JSON.stringify(data);

    fetch(url, opts)
        .then(function(r) {
            if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'Request failed'); });
            return r.json();
        })
        .then(function(res) { cb(null, res); })
        .catch(function(err) { cb(err, null); });
}

// ===== Transaction Helpers =====
function txnIconHTML(type) {
    if (type === 'credit') return '<i class="fas fa-arrow-down"></i>';
    return '<i class="fas fa-arrow-up"></i>';
}

function txnStatusHTML(status) {
    var cls = status === 'pending' ? 'pending' : 'settled';
    var label = status === 'pending' ? 'Pending' : 'Settled';
    return '<span class="txn-status ' + cls + '">' + label + '</span>';
}

function txnBadgeHTML(value, labelYes, labelNo, iconYes, iconNo, cls) {
    if (value === 'yes') {
        return '<span class="txn-badge ' + cls + ' yes"><i class="fas ' + iconYes + '"></i> ' + labelYes + '</span>';
    }
    return '<span class="txn-badge ' + cls + ' no"><i class="fas ' + iconNo + '"></i> ' + labelNo + '</span>';
}

function buildTxnItem(t, isRecent) {
    var isCredit = t.type === 'credit';
    var amountClass = isCredit ? 'credit' : 'debit';
    var sign = isCredit ? '+' : '-';
    var staffHtml = t.staff_name ? '<span><i class="fas fa-user"></i> ' + t.staff_name + '</span>' : '';

    var badges = '';
    if (!isCredit) {
        badges = txnStatusHTML(t.status) +
            txnBadgeHTML(t.scanned, 'Scanned', 'Not Scanned', 'fa-scanner', 'fa-scanner', 'badge-scanned') +
            txnBadgeHTML(t.reported, 'Reported', 'Not Reported', 'fa-upload', 'fa-upload', 'badge-reported');
    }

    var actions = '';
    if (!isRecent) {
        actions = '<div class="txn-actions">' +
            '<button class="edit-btn" data-id="' + t.id + '" title="Edit"><i class="fas fa-pen"></i></button>' +
            '<button class="delete-btn" data-id="' + t.id + '" title="Delete"><i class="fas fa-trash"></i></button>' +
            '</div>';
    }

    return '<div class="txn-item txn-' + t.type + '">' +
        '<div class="txn-icon ' + t.type + '">' + txnIconHTML(t.type) + '</div>' +
        '<div class="txn-body">' +
        '<div class="txn-desc">' + escapeHtml(t.description) + '</div>' +
        '<div class="txn-meta">' +
        '<span><i class="far fa-calendar"></i> ' + formatDate(t.date) + '</span>' +
        staffHtml +
        '</div>' +
        '<div class="txn-badges">' + badges + '</div>' +
        '</div>' +
        '<div class="txn-amount ' + amountClass + '">' + sign + formatCurrency(t.amount) + '</div>' +
        actions +
        '</div>';
}

function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== Dashboard =====
var breakdownChart = null;

function loadDashboard() {
    api('/api/dashboard', 'GET', null, function(err, data) {
        if (err) { showToast(err.message, 'error'); return; }

        // Balance card with status
        var bc = $('balance-card');
        bc.className = 'metric-card balance-card status-' + data.balance_status;
        $('balance-value').textContent = formatCurrency(data.balance);
        var statusLabels = { critical: 'Needs Replenishment', warning: 'Getting Low', good: 'Healthy' };
        $('balance-status-label').textContent = statusLabels[data.balance_status] || '';

        // Replenish alert
        var alert = $('replenish-alert');
        if (data.balance_status === 'critical') {
            alert.style.display = 'flex';
            $('alert-balance').textContent = formatCurrency(data.balance);
        } else {
            alert.style.display = 'none';
        }

        $('credit-value').textContent = formatCurrency(data.total_credit);
        $('debit-value').textContent = formatCurrency(data.total_debit);
        $('pending-value').textContent = formatCurrency(data.pending);

        // Month
        var net = data.month_credits - data.month_debits;
        var netSign = net >= 0 ? '+' : '';
        $('month-net').textContent = netSign + formatCurrency(net);
        $('month-detail').textContent = data.month_credits + ' in / ' + data.month_debits + ' out';

        // Doc status
        $('unscanned-count').textContent = data.unscanned_count;
        $('unreported-count').textContent = data.unreported_count;

        renderBreakdownChart(data);

        var recentHTML = '';
        if (data.recent && data.recent.length) {
            data.recent.forEach(function(t) { recentHTML += buildTxnItem(t, true); });
        } else {
            recentHTML = emptyHTML('No recent transactions.');
        }
        $('recent-list').innerHTML = recentHTML;
    });
}

function renderBreakdownChart(data) {
    var ctx = $('breakdownChart');
    if (!ctx) return;
    if (breakdownChart) breakdownChart.destroy();

    breakdownChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Settled Debits', 'Pending Debits', 'Available'],
            datasets: [{
                data: [
                    data.settled_debits,
                    data.pending,
                    data.balance
                ],
                backgroundColor: ['#10b981', '#f59e0b', '#6366f1'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 12,
                        usePointStyle: true,
                        font: { size: 11, family: 'Inter' }
                    }
                }
            }
        }
    });
}

// ===== Transactions List =====
var deleteTargetId = null;

function loadTransactions() {
    var search = ($('search-input') ? $('search-input').value : '');
    var type = ($('filter-type') ? $('filter-type').value : '');
    var status = ($('filter-status') ? $('filter-status').value : '');
    var scanned = ($('filter-scanned') ? $('filter-scanned').value : '');
    var reported = ($('filter-reported') ? $('filter-reported').value : '');
    var sort = ($('sort-by') ? $('sort-by').value : 'date');
    var order = ($('sort-order') ? $('sort-order').value : 'desc');

    var params = 'search=' + encodeURIComponent(search) +
        '&type=' + encodeURIComponent(type) +
        '&status=' + encodeURIComponent(status) +
        '&scanned=' + encodeURIComponent(scanned) +
        '&reported=' + encodeURIComponent(reported) +
        '&sort=' + encodeURIComponent(sort) +
        '&order=' + encodeURIComponent(order);

    api('/api/transactions?' + params, 'GET', null, function(err, data) {
        if (err) { showToast(err.message, 'error'); return; }

        var list = $('txn-list');
        var count = $('txn-count');
        if (!list) return;

        if (count) {
            count.textContent = data.count + ' transaction' + (data.count !== 1 ? 's' : '');
        }

        if (data.transactions && data.transactions.length) {
            var html = '';
            data.transactions.forEach(function(t) { html += buildTxnItem(t, false); });
            list.innerHTML = html;
            attachTxnEvents();
        } else {
            list.innerHTML = emptyHTML('No transactions match your filters.');
        }
    });
}

function attachTxnEvents() {
    document.querySelectorAll('.edit-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            openEditModal(parseInt(this.dataset.id));
        });
    });
    document.querySelectorAll('.delete-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            deleteTargetId = parseInt(this.dataset.id);
            $('confirm-overlay').classList.add('active');
        });
    });
}

function setupTransactionEvents() {
    var searchInput = $('search-input');
    if (searchInput) {
        var debounceTimer;
        searchInput.addEventListener('input', function() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(loadTransactions, 300);
        });
    }

    ['filter-type', 'filter-status', 'filter-scanned', 'filter-reported', 'sort-by', 'sort-order'].forEach(function(id) {
        var el = $(id);
        if (el) el.addEventListener('change', loadTransactions);
    });

    var addBtn = $('add-btn');
    if (addBtn) addBtn.addEventListener('click', openAddModal);

    var modalClose = $('modal-close');
    if (modalClose) modalClose.addEventListener('click', closeModal);

    var modalOverlay = $('modal-overlay');
    if (modalOverlay) modalOverlay.addEventListener('click', function(e) {
        if (e.target === this) closeModal();
    });

    var formCancel = $('form-cancel');
    if (formCancel) formCancel.addEventListener('click', closeModal);

    var txnForm = $('txn-form');
    if (txnForm) txnForm.addEventListener('submit', handleFormSubmit);

    var confirmCancel = $('confirm-cancel');
    if (confirmCancel) confirmCancel.addEventListener('click', function() {
        deleteTargetId = null;
        $('confirm-overlay').classList.remove('active');
    });

    var confirmOverlay = $('confirm-overlay');
    if (confirmOverlay) confirmOverlay.addEventListener('click', function(e) {
        if (e.target === this) { deleteTargetId = null; this.classList.remove('active'); }
    });

    var confirmYes = $('confirm-yes');
    if (confirmYes) confirmYes.addEventListener('click', function() {
        if (deleteTargetId) deleteTransaction(deleteTargetId);
    });

    // Type toggle
    var typeBtns = document.querySelectorAll('.type-btn');
    typeBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            typeBtns.forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
            var val = this.dataset.value;
            if (val === 'credit') {
                $('status-group').style.display = 'none';
                $('receipt-group').style.display = 'none';
                $('bill-group').style.display = 'none';
            } else {
                $('status-group').style.display = '';
                $('receipt-group').style.display = '';
                $('bill-group').style.display = '';
            }
        });
    });
}

// ===== Modal =====
function openAddModal() {
    $('modal-title').textContent = 'Add Transaction';
    $('txn-id').value = '';
    $('txn-form').reset();
    $('date').value = todayStr();
    $('status-group').style.display = '';
    $('receipt-group').style.display = '';
    $('bill-group').style.display = '';
    var typeBtns = document.querySelectorAll('.type-btn');
    typeBtns.forEach(function(b) { b.classList.remove('active'); });
    document.querySelector('.type-btn[data-value="debit"]').classList.add('active');
    $('form-submit').innerHTML = '<i class="fas fa-check"></i> Save';
    $('modal-overlay').classList.add('active');
}

function openEditModal(id) {
    $('modal-title').textContent = 'Edit Transaction';
    $('txn-id').value = id;
    $('form-submit').innerHTML = '<i class="fas fa-check"></i> Update';

    api('/api/transactions/' + id, 'GET', null, function(err, t) {
        if (err) { showToast(err.message, 'error'); closeModal(); return; }

        $('amount').value = t.amount;
        $('description').value = t.description;
        $('staff_name').value = t.staff_name || '';
        $('date').value = formatDateInput(t.date);

        var typeBtns = document.querySelectorAll('.type-btn');
        typeBtns.forEach(function(b) {
            b.classList.toggle('active', b.dataset.value === t.type);
        });

        if (t.type === 'credit') {
            $('status-group').style.display = 'none';
            $('receipt-group').style.display = 'none';
            $('bill-group').style.display = 'none';
        } else {
            $('status-group').style.display = '';
            $('receipt-group').style.display = '';
            $('bill-group').style.display = '';
            $('status').value = t.status || 'settled';
            $('receipt').checked = t.receipt === 'yes';
            $('scanned').checked = t.scanned === 'yes';
            $('reported').checked = t.reported === 'yes';
        }

        $('modal-overlay').classList.add('active');
    });
}

function closeModal() {
    $('modal-overlay').classList.remove('active');
    $('txn-form').reset();
    $('txn-id').value = '';
}

function handleFormSubmit(e) {
    e.preventDefault();
    var id = $('txn-id').value;
    var isEdit = !!id;

    var isCredit = document.querySelector('.type-btn.active').dataset.value === 'credit';

    var data = {
        type: isCredit ? 'credit' : 'debit',
        amount: parseFloat($('amount').value),
        description: $('description').value.trim(),
        staff_name: $('staff_name').value.trim(),
        date: $('date').value
    };

    if (!isCredit) {
        data.status = $('status').value;
        data.receipt = $('receipt').checked ? 'yes' : 'no';
        data.scanned = $('scanned').checked ? 'yes' : 'no';
        data.reported = $('reported').checked ? 'yes' : 'no';
    }

    if (!data.amount || data.amount <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }
    if (!data.description) {
        showToast('Please enter a description', 'error');
        return;
    }

    var url = isEdit ? '/api/transactions/' + id : '/api/transactions';
    var method = isEdit ? 'PUT' : 'POST';

    api(url, method, data, function(err, res) {
        if (err) { showToast(err.message, 'error'); return; }
        showToast(isEdit ? 'Transaction updated' : 'Transaction added', 'success');
        closeModal();
        loadTransactions();
    });
}

// ===== Delete =====
function deleteTransaction(id) {
    api('/api/transactions/' + id, 'DELETE', null, function(err, res) {
        if (err) { showToast(err.message, 'error'); return; }
        showToast('Transaction deleted', 'success');
        deleteTargetId = null;
        $('confirm-overlay').classList.remove('active');
        loadTransactions();
    });
}
