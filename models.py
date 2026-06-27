from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()


class Transaction(db.Model):
    __tablename__ = 'transactions'

    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(10), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    description = db.Column(db.String(200), nullable=False)
    date = db.Column(db.Date, nullable=False, default=datetime.utcnow)
    staff_name = db.Column(db.String(100), default='')
    status = db.Column(db.String(20), default='settled')
    receipt = db.Column(db.String(3), default='no')
    scanned = db.Column(db.String(3), default='no')
    reported = db.Column(db.String(3), default='no')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'type': self.type,
            'amount': self.amount,
            'description': self.description,
            'date': self.date.isoformat() if self.date else '',
            'staff_name': self.staff_name or '',
            'status': self.status or 'settled',
            'receipt': self.receipt or 'no',
            'scanned': self.scanned or 'no',
            'reported': self.reported or 'no',
            'created_at': self.created_at.isoformat() if self.created_at else ''
        }

    def __repr__(self):
        return f'<Transaction {self.id}: {self.type} {self.amount}>'
