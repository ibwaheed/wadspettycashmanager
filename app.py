import os
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from config import Config
from models import db, Transaction, User
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps

app = Flask(__name__)
app.config.from_object(Config)
db.init_app(app)

MAX_ATTEMPTS = 5
LOCKOUT_MINUTES = 0.5


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            if request.path.startswith('/api/'):
                return jsonify({'error': 'Unauthorized'}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated


def parse_date(d):
    if not d:
        return datetime.utcnow().date()
    try:
        return datetime.strptime(d, '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return datetime.utcnow().date()


def calc_balance():
    total_credit = db.session.query(db.func.coalesce(db.func.sum(Transaction.amount), 0))\
        .filter(Transaction.type == 'credit').scalar()
    total_debit = db.session.query(db.func.coalesce(db.func.sum(Transaction.amount), 0))\
        .filter(Transaction.type == 'debit').scalar()
    balance = total_credit - total_debit
    return total_credit, total_debit, balance


def calc_pending():
    return db.session.query(db.func.coalesce(db.func.sum(Transaction.amount), 0))\
        .filter(Transaction.type == 'debit', Transaction.status == 'pending').scalar()


def calc_settled_debits():
    return db.session.query(db.func.coalesce(db.func.sum(Transaction.amount), 0))\
        .filter(Transaction.type == 'debit', Transaction.status == 'settled').scalar()


def count_pending():
    return db.session.query(db.func.count(Transaction.id))\
        .filter(Transaction.type == 'debit', Transaction.status == 'pending').scalar()


def balance_status(balance):
    if balance < 1000:
        return 'critical'
    if balance < 2000:
        return 'warning'
    return 'good'


def unscanned_count():
    return db.session.query(db.func.count(Transaction.id))\
        .filter(Transaction.type == 'debit', Transaction.scanned == 'no').scalar()


def unreported_count():
    return db.session.query(db.func.count(Transaction.id))\
        .filter(Transaction.type == 'debit', Transaction.reported == 'no').scalar()


# ---- Auth Routes ----

@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('logged_in'):
        return redirect(url_for('dashboard'))

    error = None
    locked = False

    user = User.query.first()

    if user and user.locked_until and user.locked_until > datetime.utcnow():
        remaining = int((user.locked_until - datetime.utcnow()).total_seconds())
        locked = True
        error = f'Account locked. Try again in {remaining} seconds.'

    if request.method == 'POST' and not locked:
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')

        if user and check_password_hash(user.password_hash, password):
            user.failed_attempts = 0
            user.locked_until = None
            db.session.commit()
            session['logged_in'] = True
            session['username'] = user.username
            return redirect(url_for('dashboard'))
        else:
            user.failed_attempts = (user.failed_attempts or 0) + 1
            if user.failed_attempts >= MAX_ATTEMPTS:
                user.locked_until = datetime.utcnow() + timedelta(seconds=30)
                error = f'Too many failed attempts. Account locked for 30 seconds.'
            else:
                remaining = MAX_ATTEMPTS - user.failed_attempts
                error = f'Invalid username or password. {remaining} attempt(s) remaining.'
            db.session.commit()

    return render_template('login.html', error=error)


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


# ---- Protected Pages ----

@app.route('/')
@login_required
def dashboard():
    return render_template('dashboard.html')


@app.route('/transactions')
@login_required
def transactions_page():
    return render_template('transactions.html')


# ---- Protected API ----

@app.route('/api/dashboard')
@login_required
def api_dashboard():
    total_credit, total_debit, balance = calc_balance()
    pending = calc_pending()
    settled_debits = calc_settled_debits()
    pending_count = count_pending()
    status = balance_status(balance)

    today = datetime.utcnow().date()
    month_start = today.replace(day=1)
    month_credits = db.session.query(db.func.coalesce(db.func.sum(Transaction.amount), 0))\
        .filter(Transaction.type == 'credit', Transaction.date >= month_start).scalar()
    month_debits = db.session.query(db.func.coalesce(db.func.sum(Transaction.amount), 0))\
        .filter(Transaction.type == 'debit', Transaction.date >= month_start).scalar()

    recent = Transaction.query.order_by(Transaction.date.desc()).limit(5).all()

    return jsonify({
        'balance': round(balance, 2),
        'balance_status': status,
        'total_credit': round(total_credit, 2),
        'total_debit': round(total_debit, 2),
        'pending': round(pending, 2),
        'settled_debits': round(settled_debits, 2),
        'pending_count': pending_count,
        'month_credits': round(month_credits, 2),
        'month_debits': round(month_debits, 2),
        'unscanned_count': unscanned_count(),
        'unreported_count': unreported_count(),
        'recent': [t.to_dict() for t in recent]
    })


@app.route('/api/transactions')
@login_required
def api_transactions():
    search = request.args.get('search', '').strip()
    ttype = request.args.get('type', '')
    status = request.args.get('status', '')
    sort = request.args.get('sort', 'date')
    order = request.args.get('order', 'desc')

    query = Transaction.query

    if search:
        like = f'%{search}%'
        query = query.filter(
            db.or_(
                Transaction.description.ilike(like),
                Transaction.staff_name.ilike(like)
            )
        )
    if ttype:
        query = query.filter(Transaction.type == ttype)
    if status:
        query = query.filter(Transaction.status == status)
    scanned = request.args.get('scanned', '')
    if scanned:
        query = query.filter(Transaction.scanned == scanned)
    reported = request.args.get('reported', '')
    if reported:
        query = query.filter(Transaction.reported == reported)

    sort_col = getattr(Transaction, sort, Transaction.date)
    if order == 'asc':
        query = query.order_by(sort_col.asc())
    else:
        query = query.order_by(sort_col.desc())

    transactions = query.all()
    return jsonify({
        'transactions': [t.to_dict() for t in transactions],
        'count': len(transactions)
    })


@app.route('/api/transactions/<int:tid>')
@login_required
def api_get_transaction(tid):
    t = db.session.get(Transaction, tid)
    if not t:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(t.to_dict())


@app.route('/api/transactions', methods=['POST'])
@login_required
def api_create_transaction():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data'}), 400

    amount = float(data.get('amount', 0))
    if amount <= 0:
        return jsonify({'error': 'Amount must be positive'}), 400

    t = Transaction(
        type=data.get('type', 'debit'),
        amount=amount,
        description=data.get('description', ''),
        date=parse_date(data.get('date')),
        staff_name=data.get('staff_name', ''),
        status=data.get('status', 'settled') if data.get('type') == 'debit' else 'settled',
        receipt=data.get('receipt', 'no'),
        scanned=data.get('scanned', 'no'),
        reported=data.get('reported', 'no')
    )

    if t.type == 'debit' and t.status == 'settled':
        t.receipt = 'yes'

    db.session.add(t)
    db.session.commit()
    return jsonify(t.to_dict()), 201


@app.route('/api/transactions/<int:tid>', methods=['PUT'])
@login_required
def api_update_transaction(tid):
    t = db.session.get(Transaction, tid)
    if not t:
        return jsonify({'error': 'Not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data'}), 400

    if 'type' in data:
        t.type = data['type']
    if 'amount' in data:
        t.amount = float(data['amount'])
    if 'description' in data:
        t.description = data['description']
    if 'date' in data and data['date']:
        t.date = parse_date(data['date'])
    if 'staff_name' in data:
        t.staff_name = data['staff_name']
    if 'status' in data:
        t.status = data['status']
    if 'receipt' in data:
        t.receipt = data['receipt']
    if 'scanned' in data:
        t.scanned = data['scanned']
    if 'reported' in data:
        t.reported = data['reported']

    if t.type == 'debit' and t.status == 'settled':
        t.receipt = 'yes'

    db.session.commit()
    return jsonify(t.to_dict())


@app.route('/api/transactions/<int:tid>', methods=['DELETE'])
@login_required
def api_delete_transaction(tid):
    t = db.session.get(Transaction, tid)
    if not t:
        return jsonify({'error': 'Not found'}), 404
    db.session.delete(t)
    db.session.commit()
    return jsonify({'message': 'Deleted'})


# ---- Init DB (runs on import, works with gunicorn) ----

def init_db():
    with app.app_context():
        db.create_all()
        username = os.environ.get('APP_USERNAME', 'admin')
        password = os.environ.get('APP_PASSWORD', 'admin123')
        user = User.query.first()
        if user:
            user.username = username
            user.password_hash = generate_password_hash(password)
            user.failed_attempts = 0
            user.locked_until = None
        else:
            user = User(
                username=username,
                password_hash=generate_password_hash(password),
                failed_attempts=0
            )
            db.session.add(user)
        if Transaction.query.count() == 0:
            opening = Transaction(
                type='credit',
                amount=200.0,
                description='Opening Balance',
                date=datetime(2024, 1, 1).date(),
                staff_name='Opening',
                status='settled',
                receipt='yes'
            )
            replenishment = Transaction(
                type='credit',
                amount=4800.0,
                description='Replenishment from FIN Department',
                date=datetime(2024, 1, 2).date(),
                staff_name='FIN',
                status='settled',
                receipt='yes'
            )
            db.session.add_all([opening, replenishment])
        db.session.commit()


init_db()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
