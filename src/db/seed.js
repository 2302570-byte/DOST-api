/**
 * seed.js — BE-SMART Master Seed Script
 * ======================================
 * Populates a fresh database with all reference data.
 * Safe to re-run: uses INSERT ... ON CONFLICT DO NOTHING.
 *
 * Run: node src/db/seed.js
 */

require('dotenv').config();
const pool = require('../db');

// ── Bin coordinates (39 exact GPS points in Batangas City) ───────────────────
const BINS = [
  // ── Alangilan Area ────────────────────────────────────────────────────────
  { name: 'Alangilan Bin 1',    barangay: 'Alangilan',   lat: 13.786245232290279, lng: 121.06896037773457, status: 'FULL'    },
  { name: 'Alangilan Bin 2',    barangay: 'Alangilan',   lat: 13.78476754173462,  lng: 121.07329299307270, status: 'EMPTY'   },
  { name: 'Alangilan Bin 3',    barangay: 'Alangilan',   lat: 13.790123223787297, lng: 121.06981849904666, status: 'FULL'    },
  { name: 'Alangilan Bin 4',    barangay: 'Alangilan',   lat: 13.79210599852892,  lng: 121.07070866542418, status: 'QUEUED'  },
  { name: 'Alangilan Bin 5',    barangay: 'Alangilan',   lat: 13.796224000191954, lng: 121.07077142800904, status: 'EMPTY'   },
  { name: 'Alangilan Bin 6',    barangay: 'Alangilan',   lat: 13.784953859643933, lng: 121.06770918629552, status: 'FULL'    },

  // ── Kumintang Area ────────────────────────────────────────────────────────
  { name: 'Kumintang Bin 1',    barangay: 'Kumintang',   lat: 13.782683135819985, lng: 121.06929381842427, status: 'EMPTY'   },
  { name: 'Kumintang Bin 2',    barangay: 'Kumintang',   lat: 13.782096593221372, lng: 121.06626501172560, status: 'FULL'    },
  { name: 'Kumintang Bin 3',    barangay: 'Kumintang',   lat: 13.779940919110597, lng: 121.06561516865423, status: 'EMPTY'   },
  { name: 'Kumintang Bin 4',    barangay: 'Kumintang',   lat: 13.778296569371552, lng: 121.06811794778201, status: 'FULL'    },
  { name: 'Kumintang Bin 5',    barangay: 'Kumintang',   lat: 13.776718542314427, lng: 121.06652954956012, status: 'EMPTY'   },
  { name: 'Kumintang Bin 6',    barangay: 'Kumintang',   lat: 13.778083581872044, lng: 121.06538156420237, status: 'EMPTY'   },

  // ── Libjo Area ────────────────────────────────────────────────────────────
  { name: 'Libjo Bin 1',        barangay: 'Libjo',       lat: 13.760799614403194, lng: 121.06343057754574, status: 'FULL'    },

  // ── Bolbok Area ───────────────────────────────────────────────────────────
  { name: 'Bolbok Bin 1',       barangay: 'Bolbok',      lat: 13.771610043028975, lng: 121.06389009181537, status: 'FULL'    },

  // ── Poblacion (City Center) Area ──────────────────────────────────────────
  { name: 'Poblacion Bin 1',    barangay: 'Poblacion',   lat: 13.764375109354052, lng: 121.05904065905507, status: 'EMPTY'   },
  { name: 'Poblacion Bin 2',    barangay: 'Poblacion',   lat: 13.766749161314861, lng: 121.05450132408347, status: 'FULL'    },

  // ── Cuta Area ─────────────────────────────────────────────────────────────
  { name: 'Cuta Bin 1',         barangay: 'Cuta',        lat: 13.760475609353824, lng: 121.05909404504510, status: 'EMPTY'   },
  { name: 'Cuta Bin 2',         barangay: 'Cuta',        lat: 13.758408138265835, lng: 121.05682252798869, status: 'FULL'    },

  // ── Gulod Area ────────────────────────────────────────────────────────────
  { name: 'Gulod Bin 1',        barangay: 'Gulod',       lat: 13.755800629985194, lng: 121.05945939389170, status: 'EMPTY'   },
  { name: 'Gulod Bin 2',        barangay: 'Gulod',       lat: 13.756741804959866, lng: 121.05586944387350, status: 'QUEUED'  },
  { name: 'Gulod Bin 3',        barangay: 'Gulod',       lat: 13.750230648161642, lng: 121.05579002011123, status: 'FULL'    },

  // ── Sta. Rita Area ────────────────────────────────────────────────────────
  { name: 'Sta Rita Bin 1',     barangay: 'Sta. Rita',   lat: 13.754057131904379, lng: 121.05748968675618, status: 'EMPTY'   },
  { name: 'Sta Rita Bin 2',     barangay: 'Sta. Rita',   lat: 13.753439961325128, lng: 121.05221595475031, status: 'PENDING' },
  { name: 'Sta Rita Bin 3',     barangay: 'Sta. Rita',   lat: 13.754118848871236, lng: 121.04495663096930, status: 'FULL'    },

  // ── Pallocan Area ─────────────────────────────────────────────────────────
  { name: 'Pallocan Bin 1',     barangay: 'Pallocan',    lat: 13.748240234692187, lng: 121.05170764319107, status: 'EMPTY'   },
  { name: 'Pallocan Bin 2',     barangay: 'Pallocan',    lat: 13.747082440900892, lng: 121.05583302903972, status: 'EMPTY'   },
  { name: 'Pallocan Bin 3',     barangay: 'Pallocan',    lat: 13.741654650472894, lng: 121.05442751023513, status: 'FULL'    },

  // ── Kumintang East Area ───────────────────────────────────────────────────
  { name: 'Kumintang East 1',   barangay: 'Kumintang',   lat: 13.755963231760125, lng: 121.07079628869273, status: 'EMPTY'   },
  { name: 'Kumintang East 2',   barangay: 'Kumintang',   lat: 13.752301704228314, lng: 121.06509193322314, status: 'FULL'    },

  // ── Pallocan East Area ────────────────────────────────────────────────────
  { name: 'Pallocan East 1',    barangay: 'Pallocan',    lat: 13.744672086974138, lng: 121.07027639880110, status: 'EMPTY'   },
  { name: 'Pallocan East 2',    barangay: 'Pallocan',    lat: 13.758320417979661, lng: 121.07570508715693, status: 'FULL'    },
  { name: 'Pallocan East 3',    barangay: 'Pallocan',    lat: 13.762548466357680, lng: 121.08046404924681, status: 'QUEUED'  },

  // ── Outskirts (Sampaga, Dumantay, San Jose Sico) ──────────────────────────
  { name: 'Sampaga Bin 1',      barangay: 'Sampaga',     lat: 13.764060029808546, lng: 121.09246294897417, status: 'EMPTY'   },
  { name: 'Dumantay Bin 1',     barangay: 'Dumantay',    lat: 13.756558938438499, lng: 121.09710997487724, status: 'FULL'    },
  { name: 'Dumantay Bin 2',     barangay: 'Dumantay',    lat: 13.755673288635883, lng: 121.10439887338583, status: 'PENDING' },
  { name: 'San Jose Bin 1',     barangay: 'San Jose',    lat: 13.754508718220185, lng: 121.12393853368269, status: 'EMPTY'   },
  { name: 'San Jose Bin 2',     barangay: 'San Jose',    lat: 13.751872191905160, lng: 121.14013670048341, status: 'FULL'    },
];
  
// ── Truck fleet ───────────────────────────────────────────────────────────────
const TRUCKS = [
  { plate: 'BAT-10W-01', name: '10-Wheeler Truck 01', type: '10_wheeler',     capacity: 12000 },
  { plate: 'BAT-10W-02', name: '10-Wheeler Truck 02', type: '10_wheeler',     capacity: 12000 },
  { plate: 'BAT-FWD-01', name: 'Forward Truck 01',    type: 'forward_truck',  capacity: 7000  },
  { plate: 'BAT-FWD-02', name: 'Forward Truck 02',    type: 'forward_truck',  capacity: 7000  },
  { plate: 'BAT-FWD-03', name: 'Forward Truck 03',    type: 'forward_truck',  capacity: 7000  },
  { plate: 'BAT-MDT-01', name: 'Mini-Dump Truck 01',  type: 'mini_dump_truck',capacity: 3500  },
  { plate: 'BAT-MDT-02', name: 'Mini-Dump Truck 02',  type: 'mini_dump_truck',capacity: 3500  },
];

async function seed() {
  console.log('🌱 BE-SMART Seed Script\n');

  try {
    // ── Tiers ───────────────────────────────────────────────────────────────
    console.log('── Seeding tiers…');
    const tierRows = await pool.query(
      `SELECT id, name, capacity_liters FROM public.tiers ORDER BY capacity_liters ASC NULLS LAST`
    );
    const tierMap = {};
    tierRows.rows.forEach((t) => { tierMap[t.name] = t.id; });
    const tierSmall  = tierMap['Tier 1 — Small'];
    const tierMedium = tierMap['Tier 2 — Medium'];
    const tierLarge  = tierMap['Tier 3 — Large'];
    console.log(`   Found ${tierRows.rowCount} tiers ✓`);

    // ── Depot ───────────────────────────────────────────────────────────────
    console.log('── Seeding depot…');
    await pool.query(
      `INSERT INTO public.bins
         (name, street, barangay, latitude, longitude, status, is_depot)
       VALUES ($1,$2,$3,$4,$5,'EMPTY',true)
       ON CONFLICT DO NOTHING`,
      [
        'Batangas City Waste Management Facility (San Jose Sico)',
        'San Jose Sico Road',
        'San Jose Sico',
        13.746390133668127,
        121.16707210077696,
      ]
    );
    // Ensure coords are up to date even if it existed
    await pool.query(
      `UPDATE public.bins SET latitude=$1,longitude=$2 WHERE is_depot=true`,
      [13.746390133668127, 121.16707210077696]
    );
    console.log('   Depot ready ✓');

    // ── Bins ────────────────────────────────────────────────────────────────
    console.log('── Seeding 39 bins…');
    let binCount = 0;
    for (const bin of BINS) {
      let tierId = tierMedium;
      if (/Poblacion|Market|Plaza|Port/i.test(bin.name)) tierId = tierLarge;
      else if (/Sta.?Rita|Pallocan East|Sampaga|Dumantay/i.test(bin.name)) tierId = tierSmall;

      const result = await pool.query(
        `INSERT INTO public.bins
           (name, barangay, latitude, longitude, status, tier_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (name) DO NOTHING`,
        [bin.name, bin.barangay, bin.lat, bin.lng, bin.status, tierId]
      );
      if (result.rowCount > 0) binCount++;
    }
    console.log(`   ${binCount} bins inserted (skipped ${BINS.length - binCount} existing) ✓`);

    // ── Trucks ──────────────────────────────────────────────────────────────
    console.log('── Seeding trucks…');
    let truckCount = 0;
    for (const t of TRUCKS) {
      const result = await pool.query(
        `INSERT INTO public.trucks (plate_number, name, truck_type, max_capacity, status)
         VALUES ($1,$2,$3,$4,'idle')
         ON CONFLICT (plate_number) DO NOTHING`,
        [t.plate, t.name, t.type, t.capacity]
      );
      if (result.rowCount > 0) truckCount++;
    }
    console.log(`   ${truckCount} trucks inserted (skipped ${TRUCKS.length - truckCount} existing) ✓`);

    // ── Truck–Collector Assignment ───────────────────────────────────────────
    console.log('── Assigning collector@besmart.ph to Forward Truck 01…');
    const collectorResult = await pool.query(
      `SELECT id FROM public.users WHERE email = $1 LIMIT 1`,
      ['collector@besmart.ph']
    );
    if (collectorResult.rowCount > 0) {
      const collectorId = collectorResult.rows[0].id;
      await pool.query(
        `UPDATE public.trucks
         SET assigned_collector_id = $1
         WHERE plate_number = 'BAT-FWD-01'`,
        [collectorId]
      );
      console.log(`   collector@besmart.ph (${collectorId}) → Forward Truck 01 ✓`);
    } else {
      console.log('   ⚠️  collector@besmart.ph not found — skipping truck assignment');
    }

    // ── Summary ─────────────────────────────────────────────────────────────
    const { rows: summary } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM public.bins WHERE is_depot = false) AS bins,
        (SELECT COUNT(*) FROM public.bins WHERE status = 'FULL')  AS full_bins,
        (SELECT COUNT(*) FROM public.trucks)                      AS trucks,
        (SELECT COUNT(*) FROM public.tiers)                       AS tiers,
        (SELECT COUNT(*) FROM public.users)                       AS users
    `);
    const s = summary[0];
    console.log(`\n✅ Seed complete`);
    console.log(`   Bins:   ${s.bins} (${s.full_bins} FULL)`);
    console.log(`   Trucks: ${s.trucks}`);
    console.log(`   Tiers:  ${s.tiers}`);
    console.log(`   Users:  ${s.users}`);

    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  }
}

seed();
