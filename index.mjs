await import ('node:process');
const net = await import('node:net')
const readline = await import('node:readline');
const { EventEmitter } = await import('node:events');
const os = await import('node:os');

if (!process.stdin.isTTY) {
  console.log('Not in a terminal, exiting...');
  process.exit(1);
}

process.on('exit', () => {
  // console.clear()
  console.log('leaving...')
})

//get ip address to bind local server to so others can join it in LAN
function get_ip_address(family='IPv4') {
  const network_interfaces = os.networkInterfaces();

  let found = false
  let ip_address

  const interface_arr = Object.keys(network_interfaces)
  for (let i = 0; i < interface_arr.length; i++) {
    const address_arr = network_interfaces[interface_arr[i]]
    for (let j = 0; j < address_arr.length; j++) {
      if (address_arr[j].family === family) {
        ip_address = address_arr[j].address
        found = true
      }
      if (found) break
    }
    if (found) break
  }

  return ip_address
}

//global variables and constants
const GAME_SERVER_ADDRESS = get_ip_address() //changes when connecting to remote server
const GAME_SERVER_PORT = 49152 //any number i want
let new_address = GAME_SERVER_ADDRESS;
let new_port = GAME_SERVER_PORT
const TILE_SIZE = 2;
const INVINCIBILITY_FRAMES = 300
const DELIMITER = 'µ'

class Server extends EventEmitter {
  constructor(port, address='localhost', server_type='Server') {
    super()
    this.port = port
    this.address = address
    this.server_type = server_type + '/Server'
    //start the server as soon as this is initialized
    this.server = net.createServer((socket) => {
      // console.info('New client connected');
      socket.setEncoding('utf-8');
      socket.on('data', (data) => data.split(DELIMITER).slice(0, -1).forEach(task => this.emit('message', JSON.parse(task), socket)))

      socket.on('error', (error) => {
        // console.error('Error from the serverside: ', error); //like hell will i print that
      })
      socket.on('close', () => {
        this.emit('close', socket)
      })
    })

    this.server.on('connection', (socket) => {
      this.emit('connection', socket)
    })

    this.server.on('close', () => {
      console.info(`
        \r${this.server_type} shutting down...
      `);
    })

    this.server.listen(this.port, this.address, () => {
      console.info(`
        \r${this.server_type} started on:
        address: ${this.address}
        port: ${this.port}
      `);
      this.emit('start')
    })
  }
}

class Client extends EventEmitter {
  constructor(connect_to_port, connect_to_address, client_type='Client') {
    super()
    this.port = connect_to_port
    this.address = connect_to_address
    this.socket_type = client_type + '/Client'

    //connect to the server as soon as this is initialized
    this.socket = net.createConnection({
      port: this.port,
      host: this.address,
      timeout: 500
    })
    
    this.socket.on('timeout', () => {
      this.emit('connection_timeout')
    })

    this.socket.on('error', (error) => {
      if (error.code === 'ECONNRESET') {
        this.emit('server_close')
      }
    })
    
    // this.socket.on('close', (intentional) => {
    // })
    
    this.socket.on('connect', () => {
      this.socket.removeAllListeners('timeout')
      this.emit('connect')
    })

    this.socket.on('data', (data) => {
      // console.log('FOUND DATA AHHH', data.toString());
      data = data.toString()
      data.split(DELIMITER).slice(0, -1).forEach(task => this.emit('message', JSON.parse(task)))
    })
  }

  close(intentional=false) {
    this.socket.destroy(intentional)
  }

  send(message, type) {
    if (!message || !type) return console.error('insufficent parameters')

    const full_message = {}
    full_message['type'] = type
    full_message['data'] = { ...message }

    this.socket.write(JSON.stringify(full_message) + DELIMITER)
  }
  
  action(key) {
    switch (key.name) {
      case 'w':
        this.send({direction: 'N', action: 'move'}, 'move')
        break;    
      case 's':
        this.send({direction: 'S', action: 'move'}, 'move')
        break;
      case 'a':
        this.send({direction: 'W', action: 'move'}, 'move')
        break;
      case 'd':
        this.send({direction: 'E', action: 'move'}, 'move')
        break;
      case 'up':
        this.send({direction: 'N', action: 'attack'}, 'move')
        break;
      case 'down':
        this.send({direction: 'S', action: 'attack'}, 'move')
        break;
      case 'left':
        this.send({direction: 'W', action: 'attack'}, 'move')
        break;
      case 'right':
        this.send({direction: 'E', action: 'attack'}, 'move')
        break;
      case 'e':
        process.stdout.write(`Host: ${new_address}                            \r`)
        break;
      default:
        process.stdout.write(`Button ${key.name} unknown.             \r`)
        break;
    }
  }
}

class Entity {
  constructor() {
    this.is_entity = true
    this.facing_direction = ''
    this.damaged = false
  }
}

class Player extends Entity {
  constructor() {
    super()
    this.strength = 1;
    this.position = {}
    this.number = 0
  }
  toString() {
    return JSON.stringify(this.number)
  }
}

class Zombie extends Entity {
  constructor(x, y) {
    super()
    this.strength = 3;
    this.position = {x, y}
  }
  toString() {
    return 'Z'
  }
}

class Ground extends Entity {
  constructor() {
    super()
    // this.is_entity = false
    this.strength = -Infinity;
  }
  toString() {
    return ' '
  }
}

class Wall extends Entity {
  constructor() {
    super()
    // this.is_entity = false
    this.strength = Infinity;
  }
  toString() {
    return '#'
  }
}

class Game {
  constructor() {
    this.event = new EventEmitter();
    this.map = this.generate_map(10, 7)
    this.players = []
  }
  generate_map(width, height) {
    const map = []
    for (let i = 0; i < height; i++) {
      const row = []
      for (let j = 0; j < width; j++) {
        if (Math.random() > 0.8 || i === 0 || i === height-1 || j === 0 || j === width-1) {
          row.push(new Wall())
        } else {
          //spawn zombie
          if (Math.random() > 0.9) {
            row.push(new Zombie(j, i))
          } else {
            row.push(new Ground())
          }
        }
      }
      map.push(row)
    }
    return map
  }
  string_map() {
    //return a 2 dimentional array of the map
    const map = []
    for (let i = 0; i < this.map.length; i++) {
      let row = ''
      for (let j = 0; j < this.map[i].length; j++) {
        row += this.map[i][j].toString()
      }
      map.push(row)
    }    
    return map
  }
  join(player) {
    //get a random position on the map
    //while the position is not ground, place the player there
    let y;
    let x;
    do {
      y = Math.floor(Math.random() * this.map.length)
      x = Math.floor(Math.random() * this.map[0].length)
    } while (!(this.map[y][x] instanceof Ground))
    this.players.push(player)
    this.map[y][x] = player
    player.position = {x, y}
        
    for (let n = 1; n <= this.players.length + 1; n++) {
      if (this.players.every((player) => player.number !== n)) {
        player.number = n
        break
      }
    }
    
    //notify the other players
    this.event.emit('log', `Player ${player} joined`)
    this.event.emit('happening', { type: 'changes', data: [
      { x, y, what: player.toString() }
    ]})
  }
  async move(entity, action, direction) {
    console.table(this.players);
    let legal = false
    if (!entity.position) return
    
    // if its a zombie attacking, delay the logic
    if (entity instanceof Zombie) await new Promise(resolve => setTimeout(() => {resolve()}, INVINCIBILITY_FRAMES))
    const i = entity.position.y
    const j = entity.position.x
    let new_i = i
    let new_j = j

    switch (direction) {
      case 'N':
        new_i = i-1
        //check for the boundries
        if (new_i >= 0) {
          legal = true
          if (action === 'move') {
            //only if the player is stronger than the cell, he can move there
            if (this.map[new_i][new_j].strength < this.map[i][j].strength) {
              this.map[i][j].position.y--
            } else legal = false
          }
        }
        break;
      case 'S':
        new_i = i+1
        //check for the boundries
        if (new_i < this.map.length) {
          legal = true
          if (action === 'move') {
            //only if the player is stronger than the cell
            if (this.map[new_i][new_j].strength < this.map[i][j].strength) {
              this.map[i][j].position.y++
            } else legal = false
          }
        }
        break;
      case 'W':
        new_j = j-1
        //check for the boundries
        if (new_j >= 0) {
          legal = true
          if (action === 'move') {
            //only if the player is stronger than the cell
            if (this.map[new_i][new_j].strength < this.map[i][j].strength) {
              this.map[i][j].position.x--
            } else legal = false
          }
        }
        break;
      case 'E':
        new_j = j+1
        //check for the boundries
        if (new_j < this.map[i].length) {
          legal = true
          if (action === 'move') {
            //only if the player is stronger than the cell
            if (this.map[new_i][new_j].strength < this.map[i][j].strength) {
              legal = true
              this.map[i][j].position.x++
            } else legal = false
          } 
        }
        break;
      case 'NW':
        new_i = i-1
        new_j = j-1
        //check for the boundries
        if (new_i >= 0 && new_j >= 0) legal = true
        else legal = false
        break;
      case 'NE':
        new_i = i-1
        new_j = j+1
        //check for the boundries
        if (new_i >= 0 && new_j < this.map[i].length) legal = true
        else legal = false
        break;
      case 'SW':
        new_i = i+1
        new_j = j-1
        //check for the boundries
        if (new_i < this.map.length && new_j >= 0) legal = true
        else legal = false
        break;
      case 'SE':
        new_i = i+1
        new_j = j+1
        //check for the boundries
        if (new_i < this.map.length && new_j < this.map[i].length) legal = true
        else legal = false
        break;
      default:
        console.log('Unkown direction:', direction);
        break;
    }

    if (!legal) {
      //handle illegal movements, do nothing
      if (action === 'move') return
      if (action === 'attack') return
    }

    if (action === 'move') {
      //move logic that would be repetetiv
      this.map[new_i][new_j].damaged = false
      const temp = this.map[i][j]
      this.map[i][j] = this.map[new_i][new_j] //new_i & j is the player
      this.map[new_i][new_j] = temp 

      //instantly update on player move.
      this.event.emit('happening', { type: 'changes', data: [
        { x: j, y: i, what: ' ' }, 
        { x: new_j, y: new_i, what: entity.toString() }
      ]})

      let found = false
      //check in a 3x3 radius if a zombie is there
      for (let y = new_i-1; y <= new_i+1; y++) {
        for (let x = new_j-1; x <= new_j+1; x++) {
          if (this.map[y][x] instanceof Zombie) {
            // console.log('zombie at position', this.map[y][x].position);
            //check what direction the zombie needs to attack
            if (x === new_j && y > new_i) this.move(this.map[y][x], 'attack', 'N')
            if (x === new_j && y < new_i) this.move(this.map[y][x], 'attack', 'S')
            if (y === new_i && x > new_j) this.move(this.map[y][x], 'attack', 'W')
            if (y === new_i && x < new_j) this.move(this.map[y][x], 'attack', 'E')
            if (x > new_j && y > new_i) this.move(this.map[y][x], 'attack', 'NW')
            if (x > new_j && y < new_i) this.move(this.map[y][x], 'attack', 'SW')
            if (x < new_j && y > new_i) this.move(this.map[y][x], 'attack', 'NE')
            if (x < new_j && y < new_i) this.move(this.map[y][x], 'attack', 'SE')
            
            // console.log('zombie (x/y)', x, y);
            // console.log('player (new)', new_j, new_i);
            found = true
          }
          if (found) break
        }
        if (found) break
      }
    }

    if (action === 'attack') {
      //attack logic
      const enemy = this.map[new_i][new_j]
      
      //cannot attack already attacked entities, because of invincibility frames
      if (enemy.damaged === false) {
        //damage them
        enemy.strength -= entity.strength
        enemy.damaged = true

        //if entity died
        if (enemy.strength <= 0 && !(enemy instanceof Ground)) {
          //update the death of the entity
          this.event.emit('happening', { type: 'changes', data: [
            { x: new_j, y: new_i, what: 'f'+enemy.toString() }
          ]})
          //if player
          if (enemy instanceof Player) {
            this.event.emit('log', `Player ${enemy} died`)
            this.event.emit('happening', { type: 'death', who: enemy.toString() })
          }

          //kill them
          this.map[enemy.position.y][enemy.position.x] = new Ground()
          
        } else {
          //update the damage frames to the players
          this.event.emit('happening', { type: 'changes', data: [
            { x: new_j, y: new_i, what: 'd'+this.map[new_i][new_j].toString() }
          ]})

        }
        //after the INVINCIBILITY_FRAMES
        setTimeout(() => {
          //reset, the entity is no longer damaged, and can be attacked
          enemy.damaged = false
          
          //also update the map
          this.event.emit('happening', { type: 'changes', data: [
            { x: new_j, y: new_i, what: this.map[new_i][new_j].toString() }
          ]})
        }, INVINCIBILITY_FRAMES)

      }
    }
  }
}

class Display {
  constructor() {
    this.is_in_intro = false
    this.to_log = []
    this.menu_title = ''
    this.op_animation = null //interval id for 'Nevermind...' animation
    this.default_options = {
      main: [
        {id: 'play', name: 'Play game'},
        {id: 'play_online', name: 'Play online in LAN'},
        // {id: 'settings', name: 'Settings'},
        // {id: 'tutorial', name: 'Tutorial'},
        {id: 'quit', name: 'Nevermind'},
      ],
      play_online: [
        {id: 'host', name: 'Enter Host', type: 'input', placeholder: 'XXX.XXX.X.X'},
        {id: 'port', name: 'Enter Port', type: 'input', value: GAME_SERVER_PORT.toString(), placeholder: 'XXXXX'},
        {id: 'play_remote', name: 'Play together'},
        {id: 'main', name: 'Return to menu'},
      ],
      server_close: [
        {id: 'main', name: 'Return to menu'},
        {id: 'quit', name: 'Nevermind'},
      ],
      death_screen: [
        {id: 'play_again_remote', name: 'Reconnect'},
        {id: 'main', name: 'Return to menu'},
        {id: 'quit', name: 'Nevermind'},
      ]
    } //make this accessable for others to also then call show() with appropriate errors
    this.COLORS = {
      reset: '\x1b[0m',
      message: '\x1b[38;5;45m',
      placeholder: '\x1b[38;5;244m',
      pure_white: '\x1b[38;5;255m',
      error: '\x1b[38;5;9m',
      'Z': '\x1b[48;5;34mZ', //zombie
      ' ': '\x1b[48;5;0m ', //ground
      '#': '\x1b[48;5;15m\x1b[38;5;250m#', //wall

      'dZ': '\x1b[38;5;196m\x1b[48;5;34mZ', //damaged zombie
      'd ': '\x1b[38;5;196m/', //damaged ground
      'd#': '\x1b[48;5;15m\x1b[38;5;253m#', //damaged wall

      'fZ': '\x1b[38;5;196m\x1b[48;5;34mX', //final moments of zombie

      'd': '\x1b[38;5;196m/', //player damaged
      'f': '\x1b[38;5;196m0', //player killed
    };
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '',
    });

    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf-8');
  }
  
  async menu(type, options) {
    //inside the options are stored values of previous screen
    switch(type) {
      case 'main':
        this.menu_title = '\\\\ Main Menu //'
        options = this.default_options.main
        this.show(options)
      break;
      case 'play_online':
        this.menu_title = '\\\\ Play with friends //'
        options = this.default_options.play_online
        this.show(options)
        break;
      case 'server_close':
        this.menu_title = '\\\\ The server closed //'
        options = this.default_options.server_close
        this.show(options)
        break;
      case 'death_screen':
        this.menu_title = '\\\\ You died //'
        options = this.default_options.death_screen
        this.show(options)
        break;
      //cases for when a button is clicked, that is not another menu
      case 'play':
        console.log('start');
        //reset server address so it uses localhost again
        new_address = GAME_SERVER_ADDRESS;
        new_port = GAME_SERVER_PORT
        start_game()
        break;
      case 'play_remote':
        const address_to_connect = options[0].value.trim()
        const port_to_connect = options[1].value.trim()
        //check for legit host
        if (net.isIP(address_to_connect) < 1) {
          options[0].error = 'Impossible host address'
          this.show(options, 0)
          break;
        }
        //check for legit port
        if (!/^\d{4,5}$/.test(port_to_connect)) {
          options[1].error = 'Impossible port'
          this.show(options, 1)
          break;
        }
        options = this.default_options.play_online
        options[2].message = 'Connecting...'
        this.show(options, 2)
        //game start but with a remote server
        new_address = address_to_connect
        new_port = port_to_connect
        start_player()
        break    
      case 'play_again_remote':
        //playing again has 'options' variable changed, so more switch cases
        start_player()
        break
      case 'quit':
        console.clear()
        console.log('bye')
        process.exit(0)
      case 'death':
        this.intro('You died.', 'death_screen')
        break;
    }
  }
  show(options, selected_index=0) {
    //private function, only to be used by itself or by this.menu()
    console.clear()
    console.log('Welcome to TerminaRPG');
    console.log(this.menu_title);
    console.log();

    options.forEach((option, index) => {
      if (!option.type) option.type = 'select' //default option type
      if (option.type === 'input' && !option.value) option.value = '' //empty initial value
      //special animation for the 'Nevermind'
      if (option.id === 'quit' && index === selected_index) {
        process.stdout.write(`${this.COLORS.pure_white}> ${option.name}.         ${this.COLORS.reset}\r`)
        
        let i = 2
        this.op_animation = setInterval(() => {
          process.stdout.write(`${this.COLORS.pure_white}> ${options[selected_index].name}${'.'.repeat(i)}         ${this.COLORS.reset}\r`)
          if (i === 3) i = 0
          else i++
        }, 500)
      } 
      else {
        if (index === selected_index) {
          console.log(this.COLORS.pure_white + '> ' + option.name + this.COLORS.reset); //highlight selected
          if (option.message) {
            process.stdout.write('  ') //margin
            console.log(this.COLORS.message + option.message + this.COLORS.reset);
          }
        } else {
          //print the other option
          console.log(' ' + option.name);
        }
        if (index === selected_index && option.type === 'input') {
          process.stdout.write('  ') //margin
          console.log(option.value || this.COLORS.placeholder + (option.placeholder || '') + this.COLORS.reset);
        }
        if (index === selected_index && option.error) {
          process.stdout.write('  ') //margin
          console.log(this.COLORS.error + option.error + this.COLORS.reset);
        }
      }
    })

    //clean up the animation
    if (options[selected_index].id !== 'quit') clearInterval(this.op_animation)
    
    process.stdin.removeAllListeners('keypress')

    process.stdin.on('keypress', (str, key) => {
      if (key.ctrl && key.name === 'c') {
        process.exit();
      }
      else if (key.name === 'down') {
        if (selected_index < options.length - 1) {
          options[selected_index].error = '' //cleanse its error
          this.show(options, selected_index+1)
        }
      }
      else if (key.name === 'up') {
        if (selected_index > 0) {
          options[selected_index].error = '' //cleanse its error
          this.show(options, selected_index-1)
        }
      }
      else if (key.name === 'return') {
        if (options[selected_index].type !== 'input') {
          //only enter menu if it is not an input
          process.stdin.removeAllListeners('keypress')
          this.menu(options[selected_index].id, options)
        }
      }
      //on key press
      else {
        //if an input is currently focused
        if (options[selected_index].type === 'input') { 
          //backspace has now sepcial ability
          if (key.name === 'backspace') { 
            //it visually removes one character
            options[selected_index].value = options[selected_index].value.slice(0, -1)
          } else {
            //but if its a suspicious key like 'home' and 'delete'
            if (key.sequence.charCodeAt(0) < 32 || (key.sequence.charCodeAt(0) >= 127 && key.sequence.charCodeAt(0) <= 159)) {
              //do nothing cuz these keys mess with the indents
            } 
            //but if it is a normal letter
            else {
              //add it to the options value
              options[selected_index].value += key.sequence; //save the keypress in its option
            }
          }
          //and then always
          options[selected_index].error = '' //cleanse its error after changing value
          this.show(options, selected_index) //reload the screen
        }
      }
    });
  }
  async intro(message, next_menu='main') {
    this.is_in_intro = true
    process.stdin.removeAllListeners('keypress')
    
    process.stdin.on('keypress', (str, key) => {
      if (key.ctrl && key.name === 'c') {
        process.exit();
      } else {
        //skip the animation
        if (this.is_in_intro) return this.is_in_intro = false
        //and if already skipped go to main menu
        this.menu(next_menu)
      }
    });
    this.is_in_intro = true
    let displayedString = []
    for (let i = 0; i < message.length; i++) {
      if (!this.is_in_intro) {
        console.clear();
        return process.stdout.write(this.COLORS.reset + message);
      }
      console.clear();
      displayedString.push(message[i])
      process.stdout.write(`\x1b[38;5;${Math.min(Math.max(255-message.length, 232)+Math.round(i/(message.length/23)), 255)}m${displayedString.join('')}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    this.is_in_intro = false
  }
  log(data) {
    this.to_log.push(data)
  }
  process_char(char='') {
    let text_to_display = '';
    let chars = char.split('')
    //if we have to display a player,
    //meaning the last letter contains a number,
    if (!isNaN(parseInt(chars[chars.length-1]))) {
      const player_number = parseInt(chars[chars.length-1])
      //then give it a new color
      text_to_display += `\x1b[48;5;${player_number + 7}m`

      //and if the first letter is a registered modifier, for example when attacked
      if (this.COLORS[chars[0]] !== undefined) {
        //then apply that modified style
        text_to_display += this.COLORS[chars[0]]
      } else {
        text_to_display += ' ' //important
      }
    } else {
      //if it is not a player, then give it its predefined color
      text_to_display = this.COLORS[char]
    }
    return text_to_display

  }
  render(map) {
    console.clear();
    //data is a 2 dimentional array
    for (let i = 0; i < map.length; i++) {
      let row = ''
      for (let j = 0; j < map[i].length; j++) {
        row += this.process_char(map[i][j]).repeat(TILE_SIZE + 1)
      }
      for (let k = 0; k < TILE_SIZE; k++) {
        process.stdout.write(row + '\r\n')
      }
    }
    console.log(this.COLORS.reset);
  }
  async update(message) {
  }
}

const display = new Display()

//function to start game & game server
function start_game() {
  console.clear()
  console.log('loading')
  const game = new Game()

  //initialize the game's server
  const game_server = new Server(new_port, new_address, 'GameService')

  game_server.on('start', () => {
    start_player()
  })

  //when a new player has connected to our server...
  game_server.on('connection', (socket) => {
    //we set up events to send information towards that socket
    //this whole game works on events
    game.event.on('happening', (happening) => {
      //after a socket disconnects, all the events will still be emitted
      if (!socket.player) return
      //on death occastion,
      if (happening.type === 'death') {
        //only send that information to the dead client
        if (happening.who === socket.player.toString()) {
          socket.write(JSON.stringify(happening) + DELIMITER)
        }
      } else {
        socket.write(JSON.stringify(happening) + DELIMITER)
      }
    })
    game.event.on('log', (message_to_log) => {
      if (!socket.player) return
      socket.write(JSON.stringify({type: 'log', data: message_to_log}) + DELIMITER)
    })

    //and send the current state of the map to it
    socket.write(JSON.stringify(game.string_map()) + DELIMITER)

    //and might aswell save the sockets player position
    const player = new Player()
    socket.player = player
  })

  game_server.on('close', (socket) => {
    //broadcast to everyone that someone left
    game.event.emit('log', `Player ${socket.player} left`)
    //delete that player from the system
    game.players = game.players.filter((player) => player.number !== socket.player.number)
    delete socket.player
  })

  //when a player sends a message
  game_server.on('message', (message, socket) => {
    switch (message.type) {
      case 'join':
        game.join(socket.player)
        break;
      case 'move':
        game.move(socket.player, message.data.action, message.data.direction)
        // game.move(message.data.direction, socket.player)
        break
      default:
        console.log('unknown message type:', message);
    }
    // console.log('GOT MESSAGE FROM CLIENT:', message);
  })
}

function start_player() {
  //initialize the player's client
  const player_client = new Client(new_port, new_address, 'PlayerService')
  //when the player receives its first message (complete game map)
  player_client.once('message', (message) => {
    //display that
    display.render(message)
    //and then ask the server to join ourselves
    player_client.send({}, 'join')

    player_client.once('message', () => { //the second message is 'new player joined', and is 2b skipped
      player_client.on('message', (message) => {            
        //if the server sends an important message, like a new player joined
        switch (message.type) {
          case 'log':
            display.to_log.push(message.data)
            break
          case 'death': 
            //if person who died is me
            player_client.close(false)
            //show that 
            setTimeout(() => display.menu('death'), INVINCIBILITY_FRAMES)
            break;
          case 'changes':
            //for performance, move the cursor to the pixels to change and change them manually.
            message.data.forEach((change) => {
              for (let k = 0; k < TILE_SIZE; k++) {
                //move the cursor to the pixel location
                readline.cursorTo(
                  process.stdout, 
                  change.x * (TILE_SIZE + 1), //scale with the TILE_SIZE
                  change.y * TILE_SIZE + k
                ); //k is the amount of rows below
                
                process.stdout.write(display.process_char(change.what).repeat(TILE_SIZE + 1))
              }
            })
            process.stdout.write(display.COLORS.reset)
            break;
          default: 
            console.log('Unknown message received from server: ', message);
        }
        //move the cursor below the map
        readline.cursorTo(process.stdout, 0, 10*TILE_SIZE) //10 is height of map, defined in Game
        // //this will move the curosr to the bottom right of the terminal
        // readline.cursorTo(process.stdout, this.rl.output.columns, this.rl.output.rows)

        //finally log what is to log
        display.to_log.forEach(message => console.log(message + '                        '))

        display.update(message)
      })
    })
  })

  //but ofcourse, if the server is unreachable, a connection timeout will happen
  player_client.on('connection_timeout', () => {
    player_client.close() //close the client
    //go back to the play_online menu
    const options = display.default_options.play_online
    options[2].message = ''
    options[2].error = 'Connection failed'
    display.show(options, 2)
    //cant find another way to display error messages from outside
  })

  player_client.on('server_close', () => {
    display.menu('server_close')
  })
  
  display.to_log = [] //clear any previous messages

  //give keyboard control to the player
  process.stdin.removeAllListeners('keypress')
  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') {
      process.exit();
    }
    else {
      player_client.action(key)
    }
  });
}

display.intro('Welcome to TerminaRPG\nPress any key to start\n')
