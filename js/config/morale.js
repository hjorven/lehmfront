// Moral, Erschoepfung, Abloesung, Ersatz (Plan 4.1 Nr. 12, 2.2, 2.6, 5). Reine Daten, keine Logik.
// Alle Werte sind ganze Zahlen (Moral und Erschoepfung 0..100), Prozentwerte als ganze Prozent.

// --- Erschoepfung ---
export const FATIGUE_FRONT = 8;          // je Stellungsrunde vorn (Wache, Naesse, kein Schlaf)
export const FATIGUE_BATTLE = 2;         // je Gefechtsrunde vorn
export const FATIGUE_BATTLE_MOVE = 3;    // zusaetzlich je Gefechtsrunde mit Bewegung oder Sturm
export const FATIGUE_RESERVE = 10;       // Erholung je Stellungsrunde in der Reserve (Etappe)
export const FATIGUE_REST = 18;          // Erholung je Stellungsrunde im Ruhelager
export const FATIGUE_REST_PER_YIELD = 4; // je Punkt "erholung" aus dem Etappenertrag (Ruhelager, Kueche daneben)
export const FATIGUE_REST_NO_CAMP = 12;  // Ruhe ohne Ruhelager (Scheune, Keller)
export const FATIGUE_TIRED = 70;         // ab hier "erschoepft": Moral sinkt vorn
export const RESTED = 15;
export const FATIGUE_DIG_FREE = 35;      // bis hierhin graebt eine Gruppe ungebremst (Grabfaktor P04)                // ab hier gilt eine ruhende Gruppe als ausgeruht

// --- Moral ---
export const MORALE_TIRED = 3;           // Moralverlust je Stellungsrunde vorn, wenn erschoepft
export const MORALE_RESERVE = 3;         // Erholung je Stellungsrunde in der Reserve (vor Fraktionsfaktor)
export const MORALE_REST = 6;            // Erholung je Stellungsrunde im Ruhelager (vor Fraktionsfaktor)
export const MORALE_RESERVE_CAP = 75;    // in der Reserve erholt sich die Moral nur bis hierhin
export const LOSS_MORALE = 30;           // Moralverlust, wenn eine Gruppe ihre volle Sollstaerke verloere (anteilig)
export const TROST_PERCENT = 15;         // je Punkt "trost" (Kapelle, Gedenkstaette) sinkt der Verlust um so viel Prozent
export const TROST_MAX = 60;
export const CAPTURED_NEAR = 3;          // Felder: Nachbargruppen sehen die Gefangennahme
export const CAPTURED_MORALE = 5;
export const BATTLE_WON = 5;             // Moral nach gewonnenem oder abgewiesenem Gefecht
export const BATTLE_LOST = 6;

// --- Zu lange vorn ---
export const LONG_FRONT = 4;             // ab hier Bleistiftvermerk und Hinweis
export const TOO_LONG = 6;               // ab hier "zu lange vorn": Moral und Vertrauen sinken
export const TOO_LONG_MORALE = 1;        // je Runde ueber TOO_LONG (hoechstens TOO_LONG_MORALE_MAX)
export const TOO_LONG_MORALE_MAX = 4;
export const TRUST_TOO_LONG = 1;         // Vertrauen je Gruppe, die zu lange vorn ist (hoechstens TRUST_TOO_LONG_MAX je Runde)
export const TRUST_TOO_LONG_MAX = 3;
export const TRUST_RELIEF = 1;           // Vertrauen je rechtzeitig abgeloester Gruppe (hoechstens TRUST_RELIEF_MAX)
export const TRUST_RELIEF_MAX = 2;
export const FRONT_TURNS_RESERVE_DECAY = 2; // in der Reserve vergehen die Runden vorn langsam

// --- Gruppenfuehrer ---
export const LEADER_SHARE = 50;          // Prozent: Anteil der Verlustquote, mit dem der Gruppenfuehrer faellt
export const LEADER_MAX = 35;            // Prozent: hoechstens so wahrscheinlich je Verlustereignis
export const LEADER_MORALE = 15;         // Moraleinbruch beim Tod des Gruppenfuehrers (vor Fraktionsfaktor)
export const LEADER_SHOCK = 2;           // Runden ohne Moralerholung danach

// --- Moralproben (Gefechtsrunde) ---
export const CHECK_XP = 8;               // je Erfahrungsstufe
export const CHECK_LOSSES = 15;          // Abzug nach Verlusten in dieser Runde
export const CHECK_LEADER = 20;          // Abzug, wenn der Gruppenfuehrer gerade gefallen ist
export const CHECK_PINNED = 10;          // Abzug, wenn niedergehalten
export const CHECK_TIRED = 10;           // Abzug, wenn erschoepft
export const CHECK_SECTION_DIV = 5;      // (Abschnittsmoral - 50) / 5 als Zu- oder Abschlag
export const CHECK_MIN = 5, CHECK_MAX = 95;
export const BREAK_MARGIN = 30;          // so weit daneben und Moral unter BREAK_MORALE: die Gruppe weicht
export const BREAK_MORALE = 35;
export const WAVER_MORALE = 3;           // Moralverlust bei misslungener Probe

// --- Ersatz ---
export const REPLACEMENTS_PER_TURN = 3;  // Mann je Stellungsrunde vor Fraktionsfaktor (Kaldern 0,6, Morrow 1,5)
export const REPLACEMENTS_CAP = 24;      // so viele Mann warten hoechstens im Ersatzdepot
export const GREEN_TURNS = 3;            // so lange steht "Ersatz, gruen" an der Gruppe
export const GREEN_MORALE = 55;          // Ersatz kommt mit dieser Moral (Mischwert)
