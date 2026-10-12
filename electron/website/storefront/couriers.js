// Delivery companies working in Algeria with offices (stop desks) where the
// customer picks up the parcel and pays. The shop ticks the ones it works
// with (Website screen); none ticked: all are offered.
const COURIERS = [
    ['yalidine', 'Yalidine'], ['zr-express', 'ZR Express'], ['maystro', 'Maystro Delivery'], ['noest', 'Noest Express'],
    ['guepex', 'Guepex'], ['world-express', 'World Express'], ['procolis', 'Procolis'], ['ems', 'EMS Algérie Poste'],
];
const COURIER_IDS = COURIERS.map(c => c[0]);
const courierNames = (ids) => {
    const chosen = (Array.isArray(ids) ? ids : []).filter(id => COURIER_IDS.includes(id));
    return COURIERS.filter(([id]) => !chosen.length || chosen.includes(id)).map(c => c[1]);
};

module.exports = { COURIERS, COURIER_IDS, courierNames };
