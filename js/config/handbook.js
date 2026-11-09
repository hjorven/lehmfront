// Handbuch fuer Einsteiger (?scene=handbuch): die Regeln in einfachen Worten, Begriffe von A bis Z,
// zehn Ratschlaege fuer die erste Partie. Reine Daten; die Tasten kommen aus dem Dienstbuch (js/ui/settings.js).
// Die ausfuehrliche Fassung mit Bildern steht in docs/tutorial.md.

export const HANDBOOK_INTRO = 'Du bist Major Ilse Brandt und führst einen Frontabschnitt an der Asse. Du planst, gräbst, versorgst und entscheidest, wann angegriffen wird. Der Stab will Gelände, deine Leute wollen leben.';

/** Wie neue Befehle dazukommen */
export const HANDBOOK_UNLOCK = 'Am Anfang gibt es nur Bewegen, Halten und Graben. Weitere Befehle kommen mit der Grundausbildung und den Missionen von Akt 1 dazu, jeder mit einem Satz Erklärung. Wer alles sofort will: Dienstbuch, Darstellung, „Befehle im Gefecht“.';

/** Eine Runde in fünf Schritten */
export const HANDBOOK_ROUND = [
  ['Lage ansehen', 'Die Karte zeigt, was deine Gruppen sehen. Rote Fragezeichen sind Feinde, die du zuletzt gesehen hast (Geister), mit Alter in Runden.'],
  ['Befehle geben', 'Gruppe antippen, Befehl unten wählen, Ziel antippen. Ohne Befehl hält die Gruppe. Du musst nicht jede Gruppe anfassen.'],
  ['Runde ausführen', 'Ein Knopf für alles. Vorher zeigt eine Übersicht, was geplant ist. Bei einem Sturm muss der Knopf gehalten werden.'],
  ['Film ansehen', 'Beide Seiten handeln gleichzeitig. Die Runde läuft in Phasen ab: Artillerie, Bauen, Bewegung, Feuer, Versorgung, Uhr.'],
  ['Telegramm lesen', 'Jede Meldung sagt, was geschah und warum. Antippen springt zur Stelle. Fehler stehen danach mit Bleistift auf der Karte.'],
];

/** Werte oben links und am Schild */
export const HANDBOOK_VALUES = [
  ['Loren', 'Wagen der Feldbahn je Runde. Sie bringen Munition, Verpflegung und Material nach vorn und Verwundete zurück. Den Zug stellst du im Lorenplan (L).'],
  ['Munition', 'Liegt im Depot. Abschnitte vorn haben ihren eigenen Vorrat. Ohne Munition wird schwächer geschossen.'],
  ['Material', 'Für Draht, ausgebaute Gräben, Entwässerung und Gebäude der Etappe.'],
  ['Moral', 'Wie viel eine Gruppe noch aushält. Sinkt bei Verlusten, Schlamm, Hunger und wenn sie zu lange vorn liegt. Erholt sich in Reserve und Ruhelager.'],
  ['Erschöpfung', 'Steigt vorn jede Runde, beim Graben schneller. Erschöpfte Gruppen graben langsamer. Ablösen (R) hilft.'],
  ['Erfahrung', '0 bis 4. Erfahrene Gruppen treffen besser und halten mehr aus. Grüner Ersatz senkt sie.'],
  ['Unterdrückung', 'Beschossene Gruppen werden niedergehalten, auch ohne Verluste. Niedergehalten kommen sie nur halb so weit und treffen schlechter.'],
  ['Ansehen beim Stab', 'Steigt, wenn du Befehle erfüllst und Gelände hältst. Bestimmt Nachschub und Ersatz. Unter 10 wirst du abgelöst.'],
  ['Vertrauen der Truppe', 'Steigt durch Ablösung, warmes Essen, Post und geborgene Verwundete, sinkt bei hohen Verlusten. Unter 10 meutert die Truppe.'],
];

/** Begriffe von A bis Z */
export const HANDBOOK_TERMS = [
  ['Ablösung', 'Eine Gruppe aus Reserve oder Ruhe übernimmt das Feld einer Gruppe vorn, die ins Ruhelager geht. Ab sechs Runden vorn heißt es „zu lange vorn“.'],
  ['Beobachter', 'Sieht weit, vor allem von Höhen und Türmen. Nur ein Beobachter mit Leitung kann im Gefecht das Artilleriefeuer verlegen.'],
  ['Draht', 'Hält Angreifer fest. Pioniere schneiden Gassen, Artillerie zerreißt ihn. Eigener Draht hat Gassen für die eigenen Leute.'],
  ['Etappe', 'Das hintere Drittel deiner Karte: Depot, Feldbahn, Küche, Lazarett, Batterien. Bauen über das Etappenfenster (M).'],
  ['Feuerplan', 'Artillerie schießt nach Plan, nicht auf Zuruf: Vorbereitungsfeuer, Sperrfeuer, Feuerwalze, Störfeuer, Gegenbatterie. Werkzeug Feuerplan (A).'],
  ['Feuerrichtung', 'Jeder Graben hat eine Seite, über die geschossen wird. Ein eroberter Graben gibt nur halbe Deckung, bis er umgebaut ist (U).'],
  ['Feuerwalze', 'Ein Feuerplan, der Schritt für Schritt vor den eigenen Sturmgruppen herwandert. Zu früh vorbei: der Gegner steht am MG. Zu dicht: sie trifft die eigenen Leute.'],
  ['Gefechtsrunde', 'Fünf Minuten. Beginnt, sobald jemand einen Angriff ansetzt, und dauert höchstens zwölf Runden (eine Stunde).'],
  ['Geist', 'Ein Feind, den du nicht mehr siehst, aber zuletzt gesehen hast. Je älter, desto unsicherer.'],
  ['Längsfeuer', 'Ein MG am Ende eines geraden Grabens schießt ihn der Länge nach entlang. Die Deckung sinkt auf ein Drittel. Traversen verhindern das.'],
  ['Lorenplan', 'Der Zug der Feldbahn für die nächste Runde: welcher Wagen was in welchen Abschnitt fährt.'],
  ['Nebel des Krieges', 'Du siehst nur, was deine Gruppen sehen. Nachts, im Nebel und im Regen weniger. Leuchtkugeln erhellen kurz einen Kreis.'],
  ['Sanitätskette', 'Verwundete warten vorn auf eine Lore, fahren zurück, heilen im Lazarett und kommen erfahrener wieder. Ohne Sanitäter sterben Wartende.'],
  ['Schlamm', 'Regen macht den Lehm weich, Krater machen ihn zu Schlamm. Schlamm kostet Bewegung, Grabtempo und Moral. Entwässern (W) hilft im Graben.'],
  ['Schnee', 'Im Winter fällt Schnee statt Regen. Ab Knöcheltiefe dauern Wege länger, nachts frieren Posten ohne Unterstand. Tauwetter macht Schlamm.'],
  ['Stellungsrunde', 'Zwölf Stunden, Tag oder Nacht. Graben, Bauen, Ablösen, Versorgen, Feuerpläne. Der Normalfall.'],
  ['Sturm', 'Gruppen verlassen den Graben und laufen über das Niemandsland. In der Stellungsrunde heißt das „Angriff ansetzen“ (S).'],
  ['Traverse', 'Ein Knick im Graben. Kein gerades Stück über drei Felder, dann gibt es kein Längsfeuer.'],
  ['Unterstand', 'Unter Beschuss gehen Gruppen selbst hinein. Dort sind sie sicher, schießen aber nicht. Herauskommen dauert eine Gefechtsrunde: der Wettlauf zum Grabenrand.'],
  ['WEGO', 'Beide Seiten planen gleichzeitig, dann wird gerechnet. Du planst gegen das, was drüben vorhaben könnte.'],
];

/** Zehn Ratschläge für die erste Partie */
export const HANDBOOK_TIPS = [
  'Halten ist ein Befehl. Gruppen ohne Befehl halten, und oft ist das richtig.',
  'Grab nie gerade. Nimm „Traversen einfügen“ an, wenn das Kärtchen es anbietet.',
  'Leg die MG-Kegel dorthin, wo drüben jemand herkommen muss.',
  'Schick niemanden ins Niemandsland, ohne den Draht zu kennen. Pioniere schneiden Gassen.',
  'Ein Sturm braucht Artillerie. Plane erst den Feuerplan, dann den Angriff.',
  'Löse ab, bevor „zu lange vorn“ dasteht. Das hebt das Vertrauen.',
  'Sieh in den Lorenplan, sobald ein Abschnitt knapp wird. Verwundete brauchen freie Wagen.',
  'Nachts sieht niemand weit. Leuchtkugeln verraten Bewegung, aber auch dich.',
  'Unsicher? Der Taktik-Lehrling (T) sagt, was er täte und warum.',
  'Lies das Telegramm. Jede Zeile hat einen Grund, und der Bleistift auf der Karte zeigt, wo.',
];
