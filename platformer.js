// English Jump — основано на javascript-tiny-platformer (c) Jake Gordon, лицензия MIT
(function() {

  var TILE     = 32,
      METER    = TILE,
      GRAVITY  = 9.8 * 6, // гравитация (преувеличенная, как в оригинале)
      MAXDX    = 15,      // макс. горизонтальная скорость (тайлов в секунду)
      MAXDY    = 60,      // макс. вертикальная скорость (тайлов в секунду)
      ACCEL    = 1/2,     // за сколько секунд разгоняемся до MAXDX
      FRICTION = 1/6,     // за сколько секунд останавливаемся с MAXDX
      IMPULSE  = 1500,    // сила прыжка
      KEY      = { SPACE: 32, LEFT: 37, UP: 38, RIGHT: 39, A: 65, D: 68, W: 87, ENTER: 13 };

  var TASKS_PER_LEVEL = 5,
      START_LIVES     = 3,
      POINTS          = 10,
      FEEDBACK_TIME   = 1.4, // сколько секунд показываем результат ответа
      OPTIONS         = 3,   // сколько слов на экране
      SCALE           = 2,   // внутреннее разрешение холста для чёткого текста
      CARD_FONT       = 'bold 18px "Trebuchet MS", "Segoe UI", sans-serif';

  var COLS     = LEVELS[0].map[0].length,
      ROWS     = LEVELS[0].map.length,
      width    = COLS * TILE,
      height   = ROWS * TILE,
      fps      = 60,
      step     = 1/fps,
      canvas   = document.getElementById('canvas'),
      ctx      = canvas.getContext('2d'),
      bg       = document.createElement('canvas'),
      player   = {},
      cells    = [],
      slots    = [],
      cards    = [],
      floaters = [],
      audio    = null;

  var game = {
    state:   'menu', // menu | play | feedback | screen
    level:   0,
    task:    0,
    score:   0,
    lives:   START_LIVES,
    correct: 0,      // правильных ответов за всю игру
    tasks:   [],
    target:  null,   // слово, которое нужно найти
    results: [],     // ответы на текущем уровне
    timer:   0
  };

  canvas.width  = bg.width  = width  * SCALE;
  canvas.height = bg.height = height * SCALE;
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

  var t2p   = function(t)     { return t*TILE;               },
      p2t   = function(p)     { return Math.floor(p/TILE);   },
      tcell = function(tx,ty) { return cells[tx + (ty*COLS)]; };

  // timestamp — текущее время в миллисекундах
  function timestamp() {
    return window.performance && window.performance.now ? window.performance.now() : new Date().getTime();
  }

  // bound — ограничивает число диапазоном
  function bound(x, min, max) {
    return Math.max(min, Math.min(max, x));
  }

  // overlap — пересекаются ли два прямоугольника
  function overlap(x1, y1, w1, h1, x2, y2, w2, h2) {
    return !(((x1 + w1 - 1) < x2) ||
             ((x2 + w2 - 1) < x1) ||
             ((y1 + h1 - 1) < y2) ||
             ((y2 + h2 - 1) < y1));
  }

  // shuffle — возвращает перемешанную копию массива
  function shuffle(list) {
    var a = list.slice(), i, j, tmp;
    for (i = a.length - 1 ; i > 0 ; i--) {
      j = Math.floor(Math.random() * (i + 1));
      tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // $ — короткий доступ к элементу по id
  function $(id) {
    return document.getElementById(id);
  }

  // onkey — обрабатывает нажатия клавиш управления
  function onkey(ev, key, down) {
    switch(key) {
      case KEY.LEFT:  case KEY.A: player.left  = down; ev.preventDefault(); return false;
      case KEY.RIGHT: case KEY.D: player.right = down; ev.preventDefault(); return false;
      case KEY.SPACE: case KEY.UP: case KEY.W: player.jump = down; ev.preventDefault(); return false;
      case KEY.ENTER: if (down && !ev.repeat) pressScreenButton(); ev.preventDefault(); return false;
    }
  }

  // update — один шаг игровой логики
  function update(dt) {
    if (game.state === 'play' || game.state === 'feedback')
      updateEntity(player, dt);
    if (game.state === 'play')
      checkCards();
    if (game.state === 'feedback') {
      game.timer -= dt;
      if (game.timer <= 0)
        afterAnswer();
    }
    updateFloaters(dt);
  }

  // checkCards — проверяет, коснулся ли игрок карточки со словом
  function checkCards() {
    var n, card;
    for (n = 0 ; n < cards.length ; n++) {
      card = cards[n];
      if (overlap(player.x, player.y, TILE, TILE, card.x, card.y, card.w, card.h))
        return answer(card);
    }
  }

  // answer — засчитывает выбранное слово
  function answer(card) {
    var right = card.word === game.target,
        text  = game.target.ru + ' — ' + game.target.en;

    if (right) {
      game.score += POINTS;
      game.correct++;
      card.state = 'right';
      addFloater('+' + POINTS, card, '#2e9d4f');
      setBanner('Верно! ', text, 'right');
      playSound([660, 880]);
    }
    else {
      game.lives--;
      card.state = 'wrong';
      cards.forEach(function(c) { if (c.word === game.target) c.state = 'hint'; });
      addFloater('−1 ♥', card, '#d64545');
      setBanner('Неверно! ', text, 'wrong');
      playSound([300, 200]);
    }

    game.results.push({ word: game.target, right: right });
    game.state = 'feedback';
    game.timer = FEEDBACK_TIME;
    updateHud();
  }

  // afterAnswer — переходит к следующему заданию, уровню или финалу
  function afterAnswer() {
    game.task++;
    if (game.lives <= 0)
      showGameOver();
    else if (game.task >= TASKS_PER_LEVEL)
      game.level + 1 < LEVELS.length ? showLevelResult() : showFinal();
    else
      startTask();
  }

  // updateEntity — физика движения и столкновений с тайлами (из оригинала)
  function updateEntity(entity, dt) {
    var wasleft    = entity.dx  < 0,
        wasright   = entity.dx  > 0,
        falling    = entity.falling,
        friction   = entity.friction * (falling ? 0.5 : 1),
        accel      = entity.accel    * (falling ? 0.5 : 1);

    entity.ddx = 0;
    entity.ddy = entity.gravity;

    if (entity.left)
      entity.ddx = entity.ddx - accel;
    else if (wasleft)
      entity.ddx = entity.ddx + friction;

    if (entity.right)
      entity.ddx = entity.ddx + accel;
    else if (wasright)
      entity.ddx = entity.ddx - friction;

    if (entity.jump && !entity.jumping && !falling) {
      entity.ddy = entity.ddy - entity.impulse; // мгновенный толчок вверх
      entity.jumping = true;
    }

    entity.x  = entity.x  + (dt * entity.dx);
    entity.y  = entity.y  + (dt * entity.dy);
    entity.dx = bound(entity.dx + (dt * entity.ddx), -entity.maxdx, entity.maxdx);
    entity.dy = bound(entity.dy + (dt * entity.ddy), -entity.maxdy, entity.maxdy);

    if ((wasleft  && (entity.dx > 0)) ||
        (wasright && (entity.dx < 0))) {
      entity.dx = 0; // не даём трению раскачивать персонажа влево-вправо
    }

    var tx        = p2t(entity.x),
        ty        = p2t(entity.y),
        nx        = entity.x%TILE,
        ny        = entity.y%TILE,
        cell      = tcell(tx,     ty),
        cellright = tcell(tx + 1, ty),
        celldown  = tcell(tx,     ty + 1),
        celldiag  = tcell(tx + 1, ty + 1);

    if (entity.dy > 0) {
      if ((celldown && !cell) ||
          (celldiag && !cellright && nx)) {
        entity.y = t2p(ty);
        entity.dy = 0;
        entity.falling = false;
        entity.jumping = false;
        ny = 0;
      }
    }
    else if (entity.dy < 0) {
      if ((cell      && !celldown) ||
          (cellright && !celldiag && nx)) {
        entity.y = t2p(ty + 1);
        entity.dy = 0;
        cell      = celldown;
        cellright = celldiag;
        ny        = 0;
      }
    }

    if (entity.dx > 0) {
      if ((cellright && !cell) ||
          (celldiag  && !celldown && ny)) {
        entity.x = t2p(tx);
        entity.dx = 0;
      }
    }
    else if (entity.dx < 0) {
      if ((cell     && !cellright) ||
          (celldown && !celldiag && ny)) {
        entity.x = t2p(tx + 1);
        entity.dx = 0;
      }
    }

    if (entity.dx > 0)      entity.facing =  1;
    else if (entity.dx < 0) entity.facing = -1;

    entity.falling = ! (celldown || (nx && celldiag));
  }

  // setupPlayer — создаёт игрока с параметрами физики
  function setupPlayer(x, y) {
    return {
      x: x, y: y, dx: 0, dy: 0, facing: 1,
      gravity:  METER * GRAVITY,
      maxdx:    METER * MAXDX,
      maxdy:    METER * MAXDY,
      impulse:  METER * IMPULSE,
      accel:    METER * MAXDX / ACCEL,
      friction: METER * MAXDX / FRICTION,
      start:    { x: x, y: y }
    };
  }

  // resetPlayer — возвращает игрока на старт
  function resetPlayer() {
    player.x  = player.start.x;
    player.y  = player.start.y;
    player.dx = player.dy = 0;
    player.jumping = player.falling = false;
  }

  // loadLevel — разбирает карту уровня и готовит задания
  function loadLevel(index) {
    var level = LEVELS[index], x, y, ch;

    cells = [];
    slots = [];
    for (y = 0 ; y < ROWS ; y++) {
      for (x = 0 ; x < COLS ; x++) {
        ch = level.map[y].charAt(x);
        cells.push(ch === '#' ? 1 : 0);
        if (ch === 'P') player = setupPlayer(t2p(x), t2p(y));
        if (ch === 'W') slots.push({ x: x, y: y });
      }
    }

    game.level   = index;
    game.task    = 0;
    game.results = [];
    game.tasks   = shuffle(level.words).slice(0, TASKS_PER_LEVEL);

    renderBackground(level.theme);
    startTask();
  }

  // startTask — выбирает слово-цель и раскладывает варианты по платформам
  function startTask() {
    var level   = LEVELS[game.level],
        target  = game.tasks[game.task],
        others  = shuffle(level.words.filter(function(w) { return w !== target; })),
        options = shuffle([target].concat(others.slice(0, OPTIONS - 1))),
        places  = shuffle(slots).slice(0, OPTIONS);

    game.target = target;
    ctx.font = CARD_FONT;
    cards = options.map(function(word, i) {
      var w = Math.max(TILE * 2.5, ctx.measureText(word.en).width + 24),
          h = TILE + 4;
      return {
        word:  word,
        state: 'idle',
        w: w,
        h: h,
        x: t2p(places[i].x) + TILE/2 - w/2,
        y: t2p(places[i].y + 1) - h - 4
      };
    });

    resetPlayer();
    setBanner('Найди слово: ', target.ru + ' ' + target.icon, '');
    game.state = 'play';
    updateHud();
  }

  // addFloater — добавляет всплывающий текст над карточкой
  function addFloater(text, card, color) {
    floaters.push({ text: text, x: card.x + card.w/2, y: card.y - 6, color: color, life: 1 });
  }

  // updateFloaters — поднимает и гасит всплывающий текст
  function updateFloaters(dt) {
    floaters.forEach(function(f) { f.y -= 40 * dt; f.life -= dt; });
    floaters = floaters.filter(function(f) { return f.life > 0; });
  }

  // playSound — короткий сигнал из нескольких нот
  function playSound(notes) {
    if (!audio) return;
    notes.forEach(function(freq, i) {
      var osc  = audio.createOscillator(),
          gain = audio.createGain(),
          at   = audio.currentTime + i * 0.12;
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
      osc.connect(gain).connect(audio.destination);
      osc.start(at);
      osc.stop(at + 0.2);
    });
  }

  // render — рисует кадр игры
  function render(ctx, frame, dt) {
    ctx.drawImage(bg, 0, 0, width, height);
    renderCards(ctx, frame);
    renderPlayer(ctx, dt);
    renderFloaters(ctx);
  }

  // renderBackground — один раз рисует небо, холмы и платформы уровня
  function renderBackground(theme) {
    var b = bg.getContext('2d'), x, y, sky;
    b.setTransform(SCALE, 0, 0, SCALE, 0, 0);

    sky = b.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, theme.skyTop);
    sky.addColorStop(1, theme.skyBottom);
    b.fillStyle = sky;
    b.fillRect(0, 0, width, height);

    b.fillStyle = 'rgba(255,255,255,0.75)';
    [[120, 70], [470, 40], [820, 90]].forEach(function(c) {
      b.beginPath();
      b.arc(c[0], c[1], 22, 0, Math.PI * 2);
      b.arc(c[0] + 26, c[1] - 10, 28, 0, Math.PI * 2);
      b.arc(c[0] + 56, c[1], 20, 0, Math.PI * 2);
      b.fill();
    });

    renderHills(b, theme.hillFar,  height - 230, 40, 0.006);
    renderHills(b, theme.hillNear, height - 160, 30, 0.011);

    for (y = 0 ; y < ROWS ; y++) {
      for (x = 0 ; x < COLS ; x++) {
        if (!tcell(x, y)) continue;
        b.fillStyle = theme.block;
        b.fillRect(x * TILE, y * TILE, TILE, TILE);
        b.fillStyle = 'rgba(0,0,0,0.12)';
        b.fillRect(x * TILE, y * TILE + TILE - 3, TILE, 3);
        b.fillRect(x * TILE + TILE - 2, y * TILE, 2, TILE);
        if (y > 0 && !tcell(x, y - 1)) {
          b.fillStyle = theme.top;
          b.fillRect(x * TILE, y * TILE, TILE, 9);
          b.fillStyle = 'rgba(255,255,255,0.25)';
          b.fillRect(x * TILE, y * TILE, TILE, 3);
        }
      }
    }
  }

  // renderHills — волнистая полоса холмов на фоне
  function renderHills(b, color, base, amp, freq) {
    var x;
    b.fillStyle = color;
    b.beginPath();
    b.moveTo(0, height);
    for (x = 0 ; x <= width ; x += 16)
      b.lineTo(x, base + Math.sin(x * freq) * amp + Math.sin(x * freq * 2.3) * amp * 0.4);
    b.lineTo(width, height);
    b.fill();
  }

  // roundRect — контур прямоугольника со скруглёнными углами
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  // renderCards — рисует карточки с английскими словами
  function renderCards(ctx, frame) {
    var theme = LEVELS[game.level].theme;
    ctx.font = CARD_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    cards.forEach(function(card, i) {
      var bob    = card.state === 'idle' ? Math.sin((frame + i * 20) / 18) * 3 : 0,
          y      = card.y + bob,
          fill   = '#fffdf6',
          border = theme.card,
          text   = '#26313f';
      if (card.state === 'right') { fill = '#3fbf62'; border = '#1f7a3b'; text = '#fff'; }
      if (card.state === 'wrong') { fill = '#e85d5d'; border = '#9e2b2b'; text = '#fff'; }
      if (card.state === 'hint')  { border = '#3fbf62'; }

      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      roundRect(ctx, card.x + 2, y + 4, card.w, card.h, 10);
      ctx.fill();
      ctx.fillStyle = fill;
      roundRect(ctx, card.x, y, card.w, card.h, 10);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = border;
      ctx.stroke();
      ctx.fillStyle = text;
      ctx.fillText(card.word.en, card.x + card.w/2, y + card.h/2 + 1);
    });
  }

  // renderPlayer — рисует героя с глазами, смотрящими по направлению движения
  function renderPlayer(ctx, dt) {
    var x    = player.x + (player.dx * dt),
        y    = player.y + (player.dy * dt),
        look = player.facing * 3;

    ctx.fillStyle = '#ffcd3c';
    roundRect(ctx, x, y, TILE, TILE, 8);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#2b2b3a';
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + 11 + look, y + 13, 5, 0, Math.PI * 2);
    ctx.arc(x + 22 + look, y + 13, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b2b3a';
    ctx.beginPath();
    ctx.arc(x + 12 + look, y + 13, 2.4, 0, Math.PI * 2);
    ctx.arc(x + 23 + look, y + 13, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f08a5d';
    ctx.fillRect(x + 12 + look, y + 22, 9, 3);
  }

  // renderFloaters — рисует всплывающие «+10» и «−1 ♥»
  function renderFloaters(ctx) {
    ctx.font = 'bold 22px "Trebuchet MS", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    floaters.forEach(function(f) {
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    });
    ctx.globalAlpha = 1;
  }

  // updateHud — обновляет уровень, задание, очки и жизни
  function updateHud() {
    var level = LEVELS[game.level], hearts = '', n;
    for (n = 0 ; n < START_LIVES ; n++)
      hearts += n < game.lives ? '♥' : '♡';
    $('hud-level').textContent = (game.level + 1) + ' · ' + level.name;
    $('hud-task').textContent  = Math.min(game.task + 1, TASKS_PER_LEVEL) + ' / ' + TASKS_PER_LEVEL;
    $('hud-score').textContent = game.score;
    $('hud-lives').textContent = hearts;
  }

  // setBanner — меняет текст задания вверху экрана, выделяя главное
  function setBanner(text, highlight, mood) {
    var b = document.createElement('b');
    b.textContent = highlight;
    $('banner').textContent = text;
    $('banner').appendChild(b);
    $('banner').className = mood;
  }

  // showScreen — показывает один из экранов-оверлеев (или прячет все)
  function showScreen(id) {
    var screens = document.querySelectorAll('.screen'), n;
    for (n = 0 ; n < screens.length ; n++)
      screens[n].classList.toggle('hidden', screens[n].id !== id);
    $('banner').classList.toggle('hidden', !!id);
    game.state = id ? 'screen' : game.state;
  }

  // pressScreenButton — нажимает кнопку открытого экрана по Enter
  function pressScreenButton() {
    var button = document.querySelector('.screen:not(.hidden) button');
    if (button) button.click();
  }

  // fillWordList — выводит список слов уровня с отметками
  function fillWordList(list) {
    list.innerHTML = '';
    game.results.forEach(function(r) {
      var li = document.createElement('li');
      li.className = r.right ? 'right' : 'wrong';
      li.textContent = (r.right ? '✓ ' : '✗ ') + r.word.ru + ' — ' + r.word.en;
      list.appendChild(li);
    });
  }

  // levelCorrect — сколько правильных ответов на текущем уровне
  function levelCorrect() {
    return game.results.filter(function(r) { return r.right; }).length;
  }

  // showLevelResult — экран итогов уровня с кнопкой Next Level
  function showLevelResult() {
    var level = LEVELS[game.level];
    $('result-title').textContent = 'Level ' + (game.level + 1) + ' complete!';
    $('result-name').textContent  = level.name + ' — ' + level.title;
    $('result-correct').textContent = levelCorrect() + ' из ' + TASKS_PER_LEVEL;
    $('result-score').textContent = game.score;
    fillWordList($('result-words'));
    showScreen('result');
  }

  // showGameOver — экран проигрыша, когда закончились жизни
  function showGameOver() {
    $('over-level').textContent = (game.level + 1) + ' · ' + LEVELS[game.level].name;
    $('over-score').textContent = game.score;
    showScreen('gameover');
  }

  // showFinal — финальный экран после всех уровней
  function showFinal() {
    var total   = LEVELS.length * TASKS_PER_LEVEL,
        percent = game.correct / total,
        stars   = percent >= 0.9 ? 3 : percent >= 0.6 ? 2 : 1;
    $('final-stars').textContent   = '★★★'.slice(0, stars) + '☆☆☆'.slice(stars);
    $('final-score').textContent   = game.score;
    $('final-correct').textContent = game.correct + ' из ' + total;
    $('final-message').textContent = stars === 3 ? 'Excellent! Отличный результат!' :
                                     stars === 2 ? 'Good job! Хороший результат!' :
                                                   'Keep practicing! Попробуй ещё раз!';
    showScreen('final');
  }

  // startGame — новая игра с первого уровня
  function startGame() {
    if (!audio && (window.AudioContext || window.webkitAudioContext))
      audio = new (window.AudioContext || window.webkitAudioContext)();
    game.score   = 0;
    game.lives   = START_LIVES;
    game.correct = 0;
    showScreen(null);
    loadLevel(0);
  }

  // nextLevel — переход на следующий уровень
  function nextLevel() {
    showScreen(null);
    loadLevel(game.level + 1);
  }

  var counter = 0, dt = 0, now,
      last = timestamp();

  // frame — игровой цикл с фиксированным шагом физики
  function frame() {
    now = timestamp();
    dt = dt + Math.min(1, (now - last) / 1000);
    while(dt > step) {
      dt = dt - step;
      update(step);
    }
    render(ctx, counter, dt);
    last = now;
    counter++;
    requestAnimationFrame(frame);
  }

  document.addEventListener('keydown', function(ev) { return onkey(ev, ev.keyCode, true);  }, false);
  document.addEventListener('keyup',   function(ev) { return onkey(ev, ev.keyCode, false); }, false);

  $('play-button').addEventListener('click', startGame);
  $('next-button').addEventListener('click', nextLevel);
  $('retry-button').addEventListener('click', startGame);
  $('again-button').addEventListener('click', startGame);

  loadLevel(0);
  showScreen('menu');
  frame();

})();
