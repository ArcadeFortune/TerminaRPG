const { EventEmitter } = await import('node:events');
const readline = await import('node:readline');

if (!process.stdin.isTTY) {
  console.log('Not in a terminal, exiting...');
  process.exit(1);
}

//constants
const TILE_SIZE = 2;
const COLORS = {
  reset: '\x1b[0m',
  player: '\x1b[48;5;21m',
  wall: '\x1b[48;5;15m\x1b[38;5;250m',
  ground: '\x1b[48;5;0m',
};

class EventManager extends EventEmitter {}

class Entity {
  constructor() {
    // this.event = new EventManager();
    this.is_entity = true
  }
}

class Game {
  constructor(seed) {
    this.ground = new Ground()
    this.wall = new Wall()
    this.player = new Player()

    const nanotimer = process.hrtime.bigint()
    this.event = new EventManager();
    process.on('exit', () => {
      // console.log('leaving... \nit took', process.hrtime.bigint() - nanotimer, 'nanoseconds')
    })

    this.map = seed ? seed : this.generate_map(30, 10)
  }
  generate_map(width, height) {
    const map = []
    for (let i = 0; i < height; i++) {
      const row = []
      for (let j = 0; j < width; j++) {
        if (Math.random() > 0.8) {
          row.push(this.wall)
        } else {
          row.push(this.ground)
        }
      }
      map.push(row)
    }
    //add player
    map[Math.floor(height/2)][Math.floor(width/2)] = this.player
    return map
  }
  string_map(size_per_cell = 1) {
    //return a 2 dimentional array of the map
    const map = []
    for (let i = 0; i < this.map.length; i++) {
      const row = []
      for (let j = 0; j < this.map[i].length; j++) {
        row.push(this.map[i][j].toString().repeat(size_per_cell))
      }
      for (let k = 0; k < size_per_cell; k++) {
        map.push(row)
      }
    }
    return map
  }
  move(direction, entity=this.player) {
    let found = false
    //move the player in the direction
    switch (direction) {
      case 'N':
        for (let i = 0; i < this.map.length; i++) {
          for (let j = 0; j < this.map[i].length; j++) {
            if (this.map[i][j] === entity) {
              found = true
              if (i-1 >= 0) {
                //check for the boundries
                if (this.map[i-1][j].strength < this.map[i][j].strength) {
                  //only if the player is stronger than the cell
                  const temp = this.map[i][j]
                  this.map[i][j] = this.map[i-1][j]
                  this.map[i-1][j] = temp
                }
              }
            }
            if (found) break;
          }
          if (found) break;
        }
        break;
      case 'S':
        for (let i = 0; i < this.map.length; i++) {
          for (let j = 0; j < this.map[i].length; j++) {
            if (this.map[i][j] === entity) {
              found = true
              if (i+1 < this.map.length) {
                //check for the boundries
                if (this.map[i+1][j].strength < this.map[i][j].strength) {
                  //only if the player is stronger than the cell
                  const temp = this.map[i][j]
                  this.map[i][j] = this.map[i+1][j]
                  this.map[i+1][j] = temp
                }
              }
            }
            if (found) break;
          }
          if (found) break;
        }
        break;
      case 'W':
        for (let i = 0; i < this.map.length; i++) {
          for (let j = 0; j < this.map[i].length; j++) {
            if (this.map[i][j] === entity) {
              found = true
              if (j-1 >= 0) {
                //check for the boundries
                if (this.map[i][j-1].strength < this.map[i][j].strength) {
                  //only if the player is stronger than the cell
                  const temp = this.map[i][j]
                  this.map[i][j] = this.map[i][j-1]
                  this.map[i][j-1] = temp
                }
              }
            }
            if (found) break;
          }
          if (found) break;
        }
        break;
      case 'E':
        for (let i = 0; i < this.map.length; i++) {
          for (let j = 0; j < this.map[i].length; j++) {
            if (this.map[i][j] === entity) {
              found = true
              if (j+1 < this.map[i].length) {
                //check for the boundries
                if (this.map[i][j+1].strength < this.map[i][j].strength) {
                  //only if the player is stronger than the cell
                  const temp = this.map[i][j]
                  this.map[i][j] = this.map[i][j+1]
                  this.map[i][j+1] = temp
                }
              }
            }
            if (found) break;
          }
          if (found) break;
        }
        break;
      default:
        break;
    }
    if (found) game.event.emit('new_frame')
    return true
  }
}

class Player extends Entity {
  constructor() {
    super()
    this.strength = 1;
  }
  toString() {
    return COLORS.player + ' ' + COLORS.reset
  }
}

class Ground extends Entity {
  constructor() {
    super()
    this.strength = 0;
  }
  toString() {
    return COLORS.ground + ' ' + COLORS.reset
  }
}

class Wall extends Entity {
  constructor() {
    super()
    this.strength = 1000;
  }
  toString() {
    return COLORS.wall + '#' + COLORS.reset
  }
}

class Display {
  constructor() {
    this.text = ''
    this.is_in_intro = false
  }
  async intro(message) {
    this.is_in_intro = true
    game.event.once('in_game', () => {
      // console.clear();
      this.is_in_intro = false
    })
    let displayedString = []
    for (let i = 0; i < message.length; i++) {
      if (!this.is_in_intro) {
        console.clear();
        return process.stdout.write('\x1b[38;5;255m' + message);
      }
      console.clear();
      displayedString.push(message[i])
      process.stdout.write(`\x1b[38;5;${Math.min(Math.max(255-message.length, 232)+Math.round(i/(message.length/23)), 255)}m${displayedString.join('')}${COLORS.reset}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    this.is_in_intro = false
  }
  show(data, info = '') {
    console.clear();
    //data is a 2 dimentional array
    for (let i = 0; i < data.length; i++) {
      console.log(data[i].join(''));
    }
    console.log(info);
    console.log(this.text);
  }
}

////////////////////////////////////////////////////////////// main logic //////////////////////////////////////////////////////////////
process.stdout.write(`Loading...\n`); 

//input control, important if it is not run by the REPL (node.exe)
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '',
});
rl.prompt();

const game = new Game()
const display = new Display()
game.event.on('new_frame', () => {
  //repaint the whole screen when a new frame is emitted (for example a value is changed)
  display.show(game.string_map(TILE_SIZE))
})

display.intro('Welcome to my game\nPress enter to start\nPress any other key to exit\n')

process.stdin.setRawMode( true );
process.stdin.setEncoding( 'utf8' );

game.event.on('in_game', () => {
  display.show(game.string_map(TILE_SIZE))

// //refreshing with 30fps
// let i = 0;
// const interval = setInterval(() => {
//   // console.clear();
//   display.show(game.string_map())
//   console.log(i);
//   i++;
//   if (i > 10) {
//     clearInterval(interval);
//   }
// }, 1000/30);

  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') {
      process.exit();
    } else {
      switch (str) {
        case 'w':
          game.move('N')
          break;    
        case 's':
          game.move('S')
          break;
        case 'a':
          game.move('W')
          break;
        case 'd':
          game.move('E')
          break;
        default:
          break;
      }
      readline.clearLine(process.stdout, -1);
      readline.moveCursor(process.stdout, -1);
    }
  });
})

//this function needs to be at the end and there needs to be exactly one empty line after it.
process.stdin.on('keypress', (str, key) => {
  readline.clearLine(process.stdout, -1);
  readline.moveCursor(process.stdout, -1);
  if (display.is_in_intro) return display.is_in_intro = false;
  if (key.name === 'return') {
    process.stdin.removeAllListeners('keypress')
    game.event.emit('in_game')
  } else {
    process.exit();
  }
})
