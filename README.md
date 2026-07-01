# NEXUS ROYALE — Phase 1: فصل الملف الواحد إلى Modules

تقسيم آلي لـ `NEXUS_ROYALE.html` (1895 سطر، ملف واحد) إلى بنية منظمة، **بدون أي تغيير في المنطق أو السلوك** — نفس اللعبة بالضبط، فقط منظمة بشكل مختلف.

## البنية الجديدة

```
nexus-royale/
├── index.html              ← HTML فقط (نفس الماركب الأصلي حرفيًا)
├── css/
│   └── styles.css          ← كل الـ CSS (كان بين <style>...</style>)
└── js/
    ├── nav.js               ← التنقل بين الشاشات + التنبيهات (Toast)
    ├── store.js              ← طبقة التخزين (window.storage + fallback لـ localStorage)
    ├── parts.js               ← نظام القطع/القوالب العام (box/sphere/cylinder...)
    ├── character-builder.js    ← charData → THREE.Group (يُستخدم في المعاينة واللاعبين والبوتات)
    ├── terrain-builder.js       ← worldData → مشاهد الأرض + الأشجار/الصخور/الطقس
    ├── character-editor.js       ← شاشة محرر الشخصية
    ├── world-editor.js            ← شاشة محرر العالم
    ├── mold-editor.js              ← شاشة محرر القوالب (تصميم أشجار/صخور/أسلحة مخصصة)
    ├── play-menu.js                 ← شاشة اللوبي (solo / bots / online)
    ├── game-engine.js                ← حلقة اللعب، الـ HUD، البوتات، المزامنة الأونلاين
    └── boot.js                        ← نقطة البداية — يستورد كل شاشة ويشغّل التطبيق
```

## كيف اشتغلت (ولماذا تقدر تثق فيها)

كل ملف استُخرج بـ `sed` مباشرة من السطور الأصلية — **مافيه إعادة كتابة يدوية لأي منطق**، فقط إضافة أسطر `import`/`export` حول نفس الكود الأصلي حرفيًا. بعد الاستخراج شغّلت 3 تحققات آلية:

1. **فحص صياغة** (`node --check`) على كل ملف — كلها سليمة.
2. **مطابقة import/export** — كل شيء يُستورد فعلاً مُصدَّر من مصدره الصحيح (طلعت هالخطوة خطأين حقيقيين صلّحتهم: `world-editor.js` كان ناقص `WEAPON_PRESETS`، و`game-engine.js` كان ناقص `CharOptions` لعشوائية شكل البوتات).
3. **مقارنة سطر-بسطر** بين كل الكود المُعاد تجميعه من الملفات الجديدة وكل الكود الأصلي — تطابق 100%، الفرق الوحيد هو تعليقات العناوين الزخرفية (`/* ===...=== */`) اللي استبدلتها بتعليق مختصر بأول كل ملف.

**اللي ما قدرت أتحقق منه:** ما عندي متصفح هنا لتشغيل Three.js فعليًا. الفحص تأكد من الصياغة والـ imports فقط، مو من سلوك اللعبة الفعلي في المتصفح. جرّبها محليًا قبل ما تعتمد عليها.

## تشغيل محلي

ES Modules ما تشتغل من `file://` مباشرة (سيتحجب بسبب CORS). لازم سيرفر بسيط:

```bash
npx serve nexus-royale
# أو
cd nexus-royale && python3 -m http.server 8000
```

نفس الشي إذا رفعتها Vercel / GitHub Pages / Hugging Face Spaces — تشتغل عادي لأنها HTTP فعلي.

## خريطة الاعتماديات بين الملفات

```
nav.js  ←  store.js  ←  parts.js  ←  character-builder.js ─┐
                              ↖  terrain-builder.js ────────┤
                                                              ├→ character-editor.js ⇄ mold-editor.js
                                                              ├→ world-editor.js ⇄ mold-editor.js
                                                              └→ game-engine.js ← play-menu.js ← boot.js
```

فيه دورتين اعتماد متبادل (circular imports) بين `character-editor.js`/`mold-editor.js` و بين `mold-editor.js`/`world-editor.js` — نفس البنية الموجودة أصلاً بالملف الواحد (كل الاستدعاءات المتبادلة داخل event handlers، مو top-level، فهي آمنة في ES Modules).

## الخطوة الجاية

راجع الرد بالمحادثة للتصحيحات على المراجعة الأصلية وترتيب مقترح للمراحل 2-4.
