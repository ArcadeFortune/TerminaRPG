await import ('node:process');
const os = await import('node:os')
const net = await import('node:net')
const dgram = await import('node:dgram');
const readline = await import('node:readline');
const { EventEmitter } = await import('node:events');

if (!process.stdin.isTTY && process.argv.length <= 2) {
  console.log('Not in a terminal, exiting...');
  process.exit(1);
}

process.on('exit', () => {
  // console.clear()
  console.log('leaving...')
})

//get ip address to bind local server to so others can join it in LAN
function get_ip_address(family='IPv4') {
  let ip_address = '127.0.0.1'
  let found = false

  try {
    const network_interfaces = os.networkInterfaces();

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

  }
  catch (error) {
    //https://github.com/nodejs/help/issues/4058
    console.log('You must be playing on an android phone :)')
  }
  return ip_address
}

//#region global variables
const DEFAULT_GAME_SERVER_ADDRESS = get_ip_address()
const DEFAULT_GAME_SERVER_PORT = 49152
const MULTICAST_ADDRESS = '224.69.69.69'
const INVINCIBILITY_FRAMES = 300
//sometimes multiple data combines into one
//the delimiter is used to split them correctly
const DELIMITER = 'µ'
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '',
});

/**
 * Multicast class
 * Using this class you can send and receive messages to and from a multicast address
 * @param {String} type should be 'server' or 'client'
 * @extends EventEmitter
 * @fires `message` containing two arguments, the message and the rinfo
 */
class Multicast extends EventEmitter {
  constructor(type='server') {
    super()
    this.type = type
    this.server = dgram.createSocket('udp4');
    this.server.on('error', (err) => {
      // DEBUG(`server error:\n${err}`);
      this.server.close();
    });
    this.server.on('message', (msg, rinfo) => {
      // DEBUG(`${this.type} got: ${msg} from ${rinfo.address}:${rinfo.port}`);
      this.emit('message', msg, rinfo)
    })
  }
  listen(cb=()=>{}) {
    let port = 0;
    if (this.type === 'server') port = DEFAULT_GAME_SERVER_PORT
    this.server.bind(port, undefined, () => {
      this.server.setBroadcast(true);
      this.server.setMulticastTTL(128);
      this.server.addMembership(MULTICAST_ADDRESS);
      // const address = this.server.address();
      // DEBUG(`${this.type} listening ${address.address}:${address.port}`)
      cb()
    });
  }
  /**
   * broadcast a message to everyone in the multicast group
   * @param {String} message 
   */
  broadcast(message) {
    //broadcast message to all servers
    // DEBUG(`sending ${message} to all servers at ${MULTICAST_ADDRESS}:${DEFAULT_GAME_SERVER_PORT}`);
    this.server.send(message, DEFAULT_GAME_SERVER_PORT, MULTICAST_ADDRESS);
  }
  /**
   * send a message to a specific client
   * @param {String} message 
   * @param {Number} port of the receipient
   * @param {String} address of the receipient
   */
  send(message, port, address) {
    //send message to specific client
    // DEBUG(`sending ${message} to client at ${address}:${port}`);
    this.server.send(message, port, address);
  }
  close() {
    try {
      this.server.close();
      //close() will be called multiple times
      //because the display tries to close it every time the main menu opens
    } catch (e) {
      // DEBUG('error closing server', e)
    }
  }
}

//#region Server code
/**
 * this function starts the game server and its logic
 * it also starts the discovery service for the game
 * @param {Function} cb_on_server_start this will be called
 * when the server has started
 * @returns a function to stop the server
 */
function server(cb_on_server_start=()=>{}) {
  const MAP_WIDTH = 30
  const MAP_HEIGHT = 10
  const PLAYER_RENDER_DISTANCE = 7
    
  //allow the server to be stopped by user input
  process.stdin.removeAllListeners('keypress')
  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') {
      process.exit(0);
    }
  });

  function DEBUG(...text) {
    //the client calls this function with a callback, so it should not log anything
    const is_running_without_client = cb_on_server_start.toString().replace(/\s+/g, '') === '()=>{}'
    if (is_running_without_client) console.log(...text);
  }

  class Entity {
    constructor() {
      this.is_entity = false
      this.damaged = false
      this.health = 0
    }
  }

  class TheLiving extends Entity {
    constructor() {
      super()
      this.is_entity = true
      this.default_health = 0
      this.default_strength = 0
      this.strength = 0;
      this.kills = 0
      this.deaths = 0
      //timestamp of when the last attack was
      this.last_attack = Date.now()
    }  
    reset() {
      this.strength = this.default_strength
      this.health = this.default_health
    }
  }

  class Player extends TheLiving {
    constructor() {
      super()
      this.default_health = 10
      this.default_strength = 1
      this.health = this.default_health
      this.strength = this.default_strength
      this.position = {
        x: null,
        y: null
      }
      this.number = 0
    }
    toString() {
      return JSON.stringify(this.number)
    }
  }

  class Zombie extends TheLiving {
    constructor(x, y) {
      super()
      this.default_strength = 3
      this.default_health = 3
      this.health = this.default_health
      this.strength = this.default_strength
      this.position = {x, y}
    }
    toString() {
      return 'Z'
    }
  }

  class Ground extends Entity {
    constructor() {
      super()
      this.strength = -Infinity;
      this.health = -Infinity
    }
    toString() {
      return ' '
    }
  }

  class Wall extends Entity {
    constructor() {
      super()
      this.strength = Infinity;
      this.health = Infinity
    }
    toString() {
      return '#'
    }
  }

  class Scoreboard {
    constructor() {
      this.players = {}
    }
    add(player) {
      this.players[player.toString()] = {
        kills: player.kills || 0, 
        deaths: player.deaths || 0
      }
    }
    remove(player) {
      delete this.players[player.toString()]
    }
    increase_kills(player) {
      this.players[player.toString()].kills++
    }
    increase_deaths(player) {
      this.players[player.toString()].deaths++
    }
    toString() {
      return this.players
    }
  }

  //#region game logic
  /**
   * Game logic
   * @extends EventEmitter
   * @fires events types like scoreborad, join, kill, changes. however, they are emitted as a 'happening' event
   * so the server can properly parse the data for the client to process
   */
  class Game extends EventEmitter {
    constructor() {
      super()
      this.map = this.generate_map(MAP_WIDTH, MAP_HEIGHT)
      this.players = []
      this.scoreboard = new Scoreboard()
    }
    /**
     * generates a map with walls, ground and zombies
     * @param {Number} width 
     * @param {Number} height 
     * @returns a 2D array of the generated map
     */
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
    /**
     * takes the current map and creates a copy array of it
     * @param {Player} player
     * @returns a string representation of the map in an array
     */
    string_map(player) {
      const map = []
      const start_x = 0
      const start_y = 0
      const end_x = this.map[0].length
      const end_y = this.map.length
      //render distance for another day
      // const start_x = Math.max(0, player.position.x - PLAYER_RENDER_DISTANCE);
      // const start_y = Math.max(0, player.position.y - PLAYER_RENDER_DISTANCE);
      // const end_x = Math.min(this.map[0].length, player.position.x + PLAYER_RENDER_DISTANCE + 1);
      // const end_y = Math.min(this.map.length, player.position.y + PLAYER_RENDER_DISTANCE + 1);
      for (let i = start_y; i < end_y; i++) {
        let row = ''
        for (let j = start_x; j < end_x; j++) {
          row += this.map[i][j].toString()
        }
        map.push(row)
      }    
      return map
    }
    /**
     * gives the player a position on the map
     * 
     * this function should only be called if the player is not on the map
     * using this as a 'rejoin' function works too
     * @param {Player} player 
     */
    join(player) {
      let y;
      let x;
      do {
        //get a random position on the map
        y = Math.floor(Math.random() * this.map.length)
        x = Math.floor(Math.random() * this.map[0].length)
      } while (!(this.map[y][x] instanceof Ground))
      //try again until it finds a ground cell
  
      //add the player to the game
      this.players.push(player)
      this.map[y][x] = player
      player.position = {x, y}
      
      //give the player a number if he doesn't have one
      if (!player.number) {
        for (let n = 1; n <= this.players.length + 1; n++) {
          if (this.players.every((player) => player.number !== n)) {
            player.number = n
            break
          }
        }
      }
      
      //add him to the scoreboard with the kills and deaths
      //the player needs to have a number to be added to the scoreboard
      this.scoreboard.add(player)
      
      //update the others about a new player
      this.emit('happening', {
        type: 'join',
        data: [
          { x, y, what: player.toString() }
        ],
      })

      //update the scoreboard as well
      this.emit('happening', { 
        type: 'scoreboard', 
        data: this.scoreboard.toString()
      })
    }
    /**
     * delete a player from the map
     * @param {Player} player 
     */
    leave(player) {
      this.kill(null, player)
      this.scoreboard.remove(player.toString())
      //update the scoreboard, this.kill's update does not include the removed player
      this.emit('happening', { 
        type: 'scoreboard', 
        data: this.scoreboard.toString() 
      })
      this.players = this.players.filter((p) => p.number !== player.number)
    }
    /**
     * an entity moves north
     * or a zombie attacks south
     * and so on
     * 
     * 'never let them know your next move'
     * @param {TheLiving} entity 
     * @param {String} action 
     * 'move' or 'attack'
     * @param {String} direction
     * 'N', 'S', 'W', 'E', 'NW', 'NE', 'SW', 'SE' 
     */
    async move(entity, action, direction) {
      if (!entity.position) return

      // if its a zombie, delay the logic
      if (entity instanceof Zombie) {
        await new Promise(resolve => {
          setTimeout(resolve, INVINCIBILITY_FRAMES)
        })
      }

      //if the entity is dead, do nothing
      if (entity.health <= 0) return;
      
      const i = entity.position.y
      const j = entity.position.x
      let new_i = i
      let new_j = j
      let legal = false

      //check if the direction is legal
      switch (direction) {
        case 'N':
          new_i = i-1
          if (new_i >= 0) {
            legal = true
            if (action === 'move') {
              //only if the player is stronger than the cell
              if (this.map[new_i][new_j].strength < this.map[i][j].strength) {
                this.map[i][j].position.y--
              } else legal = false
            }
          }
          break;
        case 'S':
          new_i = i+1
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
          if (new_i >= 0 && new_j >= 0) legal = true
          else legal = false
          break;
        case 'NE':
          new_i = i-1
          new_j = j+1
          if (new_i >= 0 && new_j < this.map[i].length) legal = true
          else legal = false
          break;
        case 'SW':
          new_i = i+1
          new_j = j-1
          if (new_i < this.map.length && new_j >= 0) legal = true
          else legal = false
          break;
        case 'SE':
          new_i = i+1
          new_j = j+1
          if (new_i < this.map.length && new_j < this.map[i].length) legal = true
          else legal = false
          break;
        default:
          DEBUG('!! Unkown direction:', direction);
          break;
      }

      //handle illegal movements, do nothing for now
      if (!legal) {
        if (action === 'move') return
        if (action === 'attack') return
      }

      //move logic
      if (action === 'move') {
        //new_i & j is the player's new position
        this.map[new_i][new_j].damaged = false
        //switch the entities
        const temp = this.map[i][j]
        this.map[i][j] = this.map[new_i][new_j] 
        this.map[new_i][new_j] = temp 

        //instantly update on player move.
        this.emit('happening', { 
          type: 'changes', 
          data: [
            { x: j, y: i, what: ' ' }, 
            { x: new_j, y: new_i, what: entity.toString() }
          ]
        })

        //check in a 3x3 radius if a zombie is there so it can attack
        let found = false
        for (let y = new_i-1; y <= new_i+1; y++) {
          for (let x = new_j-1; x <= new_j+1; x++) {
            if (this.map[y][x] instanceof Zombie) {
              //check in which direction the zombie needs to attack
              if (x === new_j && y > new_i) this.move(this.map[y][x], 'attack', 'N')
              if (x === new_j && y < new_i) this.move(this.map[y][x], 'attack', 'S')
              if (y === new_i && x > new_j) this.move(this.map[y][x], 'attack', 'W')
              if (y === new_i && x < new_j) this.move(this.map[y][x], 'attack', 'E')
              if (x > new_j && y > new_i) this.move(this.map[y][x], 'attack', 'NW')
              if (x > new_j && y < new_i) this.move(this.map[y][x], 'attack', 'SW')
              if (x < new_j && y > new_i) this.move(this.map[y][x], 'attack', 'NE')
              if (x < new_j && y < new_i) this.move(this.map[y][x], 'attack', 'SE')
              found = true
            }
            if (found) break
          }
          if (found) break
        }
      }

      //attack logic
      else if (action === 'attack') {
        //cannot attack right after the last attack
        if (entity.last_attack > Date.now() - INVINCIBILITY_FRAMES) return
        //refresh the timestamp of the last attack
        entity.last_attack = Date.now()

        const enemy = this.map[new_i][new_j]

        //cannot attack already attacked entities, because of invincibility frames
        if (enemy.damaged === false) {
          //damage them
          enemy.health -= entity.strength
          enemy.damaged = true

          //if entity dies
          if (enemy.health <= 0 && !(enemy instanceof Ground)) {
            this.kill(entity, enemy)            
          } else {
            //update the damage frames to the players
            this.emit('happening', { 
              type: 'changes', 
              data: [
                { x: new_j, y: new_i, what: 'd'+this.map[new_i][new_j].toString() }
              ],
            })
            //after the INVINCIBILITY_FRAMES
            setTimeout(() => {
              //reset, the entity is no longer damaged, and can be attacked
              enemy.damaged = false          
              //also update the map
              this.emit('happening', { 
                type: 'changes', 
                data: [
                  { x: new_j, y: new_i, what: this.map[new_i][new_j].toString() }
                ]
              })
            }, INVINCIBILITY_FRAMES)
          }
        }
      }
    }    
    /**
     * removes the entity from the map 
     * and updates the scoreboard
     * @param {TheLiving} killer
     * if null, the victim is a player that left
     * @param {TheLiving} victim
     * 
     */ 
    kill(killer, victim) {
      const { x, y } = victim.position
      //if the victim is not there, do nothing
      if (this.map[y][x] !== victim) return
      //update the death of the victim
      this.emit('happening', { 
        type: 'changes', 
        data: [
          { x: x, y: y, what: 'f'+victim.toString() }
        ]
      })
      //replace the victim with a ground cell, how cruel
      this.map[y][x] = new Ground()
      
      //after the INVINCIBILITY_FRAMES
      setTimeout(() => {
        //is vicitim.damaged neccessary?
        victim.damaged = false
        //also update the map
        this.emit('happening', { 
          type: 'changes', 
          data: [
            { x: x, y: y, what: this.map[y][x].toString() }
          ]
        })
      }, INVINCIBILITY_FRAMES)

      //if a player died
      if (victim instanceof Player) {
        //update the kill counter for the victim
        victim.deaths++
        this.scoreboard.increase_deaths(victim)

        //reset the player (does not reset the kills though)
        victim.reset()

        //if it was a player kill
        if (killer instanceof Player) {
          //update the kill counter for the killer
          killer.kills++
          this.scoreboard.increase_kills(killer)
        }

        //notify the other players
        this.emit('happening', { 
          type: 'scoreboard', 
          data: this.scoreboard.toString() 
        })

        this.emit('happening', { 
          type: 'kill', 
          killer: killer?.toString(), 
          victim: victim.toString()
        })
        DEBUG(`>> ${killer instanceof Player ? 'Player ' + killer : killer} killed Player ${victim}`)
      }
    }
  }
  //#endregion

  //initialize the game
  const game = new Game()

  //#region server
  //initialize the game's server
  const server = net.createServer()

  //if i ever hope to close the server one day
  //then the clients must be closed individually
  const clients = []

  //when a new player has connected to our server...
  server.on('connection', (socket) => {
    const player = new Player()
    socket.player = player
    socket.prevPlayer = {  }
    socket.setEncoding('utf-8');
    clients.push(socket)

    //handle the data from the client
    socket.on('data', (data) => {
      data.split(DELIMITER).slice(0, -1).forEach(task => {
        const message = JSON.parse(task)
        DEBUG(`> Got message from player ${socket.player}:`, message);

        switch (message.type) {
          case 'join':
            //register the player
            game.join(socket.player)            
            //send the full map to the player
            socket.write(JSON.stringify({type: 'map', data: game.string_map(socket.player), player: socket.player}) + DELIMITER)
            DEBUG(`>> Player ${socket.player} joined`);
            break;
          case 'move':
            game.move(socket.player, message.data.action, message.data.direction)
            break;
          case 'map':
            socket.write(JSON.stringify({type: 'map', data: game.string_map(socket.player), player: socket.player}) + DELIMITER)
            break;
          case 'chat':
            //remove the escape sequences from the message
            const clean_message = message.data.message.replace(/\x1B\[A|\x1B\[B/g, '')
            //send the message to all players
            game.emit('happening', { type: 'chat', data: { message: clean_message, who: socket.player.toString() } })
            break;
          default:
            DEBUG('!! unknown message type:', message);
            break;
        }
      })
    })
    //handle the disconnection of the client
    socket.on('close', () => {
      DEBUG(`>> Player ${socket.player} disconnected.`)
      game.leave(socket.player)
      game.off('happening', handle_new_changes)
      delete socket.player
    })
    //handle errors
    socket.on('error', (error) => {
      DEBUG('>> Player disconnected because: ', error.code);
    })
    //handle new changes from the game
    //define logic to send the changes to the player
    function handle_new_changes(changes) {
      if (!socket.player) return
     
      //get changes of the player
      const player_changes = {};
      for (const key in socket.player) {
        if (socket.player[key] !== socket.prevPlayer[key]) {
          player_changes[key] = socket.player[key];
        }
      }
      socket.prevPlayer = { ...socket.player }
      //send the happening to the player as well as any changes
      const obj = { ...changes, player: player_changes}
      DEBUG(`Sending to player ${socket.player}:`, obj)
      socket.write(JSON.stringify(obj) + DELIMITER)
    }
    //register the playersocket to the game's happening event
    game.on('happening', handle_new_changes)
  })

  //when the server is already running
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      cb_on_server_start()
    } else {
      console.error(error)
    }
  });
  //start the server
  server.listen(DEFAULT_GAME_SERVER_PORT, DEFAULT_GAME_SERVER_ADDRESS, () => {
    DEBUG(`>> Game server started on:
      \r\taddress: ${DEFAULT_GAME_SERVER_ADDRESS}
      \r\tport: ${DEFAULT_GAME_SERVER_PORT}`);
      
    cb_on_server_start()
  })
  //#endregion

  //#region discovery service
  //initialize the discovery service for the game
  const multicast_server = new Multicast('server')

  //when a player is looking for a game
  multicast_server.on('message', (msg, client_info) => {
    switch (msg.toString()) {
      case 'LFG':
        multicast_server.send('i am here', client_info.port, client_info.address)
        break;
      default:
        DEBUG('!! unknown message:', msg.toString());
        break;
    }
  });
  
  //start the discovery service
  multicast_server.listen()
  //#endregion

  console.clear()

  //return a function to stop the server
  return () => {
    DEBUG('>> stopping server...')
    clients.forEach(client => client.end())
    server.close()
    multicast_server.close()
  }
}

//#region client code
// Client code //
function client() {
  const TITLE = `Welcome to TerminaRPG\n           ▔▔▔▔▔▔▔▔▔▔`
  const DEFAULT_SCREEN_WIDTH = process.stdout.columns
  const DEFAULT_SCREEN_HEIGHT = 20
  const DEFAULT_CHAT_HEIGHT = process.stdout.rows - DEFAULT_SCREEN_HEIGHT - 3
  // const DEFAULT_SCREEN_HEIGHT = process.stdout.rows - DEFAULT_CHAT_HEIGHT
  const TILE_SIZE = 2;

  class Display {
    constructor() {
      //ingame variables
      this.screen_width = DEFAULT_SCREEN_WIDTH
      this.screen_height = DEFAULT_SCREEN_HEIGHT
      this.chat_height = DEFAULT_CHAT_HEIGHT
      this.scoreboard = []
      this.chat_log = []
      this.writing_message = ''
      this.chat = (msg) => this.chat_log.push(msg)
      this.clear_chat = () => this.chat_log = []
      this.player = {}
      this.update_player = (new_stats) => Object.assign(this.player, new_stats)
      //menu variables
      this.game_server_port = DEFAULT_GAME_SERVER_PORT
      this.game_server_address = DEFAULT_GAME_SERVER_ADDRESS
      this.menu_title = ''
      this.state = ''
      this.current_options = []
      this.current_index = 0
      this.op_animation = null
      this.stop_server = () => {}
      this.client = {
        socket: null,
        connect: () => {
          //casually have the entire client code in here
          //#region client logic
          this.client.socket = net.createConnection({
            port: this.game_server_port,
            host: this.game_server_address,
            timeout: 500
          })
          this.client.socket.setEncoding('utf-8')

          //if the client cannot connect to the server
          this.client.socket.on('timeout', () => {
            //close the client
            this.client.close({code: 'timeout'}) 
          })

          //handle errors
          this.client.socket.on('error', (error) => {
            switch (error.code) {
              //if the server closes unexpectedly
              case 'ECONNRESET':
                this.menu('server_close')
                break;
              //when the server cannot be reached
              case 'timeout':
                //go back to the play_online menu with an error message
                const options = this.current_options
                const index = this.current_index
                options[index].message = ''
                options[index].error = 'Connection failed'
                this.show()
                break;
              default:
                //not giving a reason on client.close(), means it is intentional
                break;
            }
          })

          //when the socket closes
          this.client.socket.on('close', () => {
            //please look at socket.on('error')
          })

          //when the socket successfully connects
          this.client.socket.on('connect', () => {
            //remove the timeout listener
            this.client.socket.removeAllListeners('timeout')
            //ask the server to join the game
            this.client.join()
          })

          //when the socket receives data
          this.client.socket.on('data', (data) => {
            //dont update while in intro
            if (this.state === 'death_screen') return

            data.split(DELIMITER).slice(0, -1).forEach(task => {
              const message = JSON.parse(task)
              //update the client's player stats
              this.update_player(message.player)

              switch (message.type) {
                case 'map':
                  this.render(message.data)
                  break;
                case 'join': 
                  //log in chat
                  this.chat(`Player ${message.data[0].what} joined`)
                  //there is no break here because a join message
                  //should also update the map
                  //meaning this.update should be called anyway
                  //so to reduce redundancy we do not break this case
                  //ohhhhhh yeahhhh
                case 'changes':
                  this.update(message.data)
                  break;
                case 'scoreboard':
                  this.scoreboard = message.data
                  break;
                case 'kill':
                  //if the killer is undefined
                  if (!message.killer) {
                    this.chat(`Player ${message.victim} left`)
                  }
                  //else if killer is not a player
                  else if (isNaN(parseInt(message.killer))) {
                    this.chat(`Player ${message.victim} died`)
                  }
                  //if both are players
                  else {
                    this.chat(`Player ${message.killer} killed player ${message.victim}`)
                  }
                  //if this client dies, go to the death screen
                  if (parseInt(message.victim) === parseInt(this.player.number)) {
                    this.player.health = 0 //on death, the players health is resest, so we manually change it
                    setTimeout(() => this.menu('death'), INVINCIBILITY_FRAMES)
                  }
                  break;
                case 'chat':
                  this.chat(`Player ${message.data.who}: ${message.data.message}`)
                  break;
                default: 
                  DEBUG('Unknown message received from server: ', message);
              }

              //move the cursor below the map
              readline.cursorTo(process.stdout, 0, this.screen_height)
              // //this will move the curosr to the bottom right of the terminal
              // readline.cursorTo(process.stdout, this.rl.output.columns, this.rl.output.rows)
              let color = this.COLORS.reset

              //if the player is damaged, render the hearts red
              if (this.player.damaged) color = '\x1b[38;5;196m'
              console.log(color + this.render_health(this.player.health) + this.COLORS.reset);

              this.chat_log.slice(-this.chat_height).forEach(message => console.log(message + '                        '))
              //temporarly remove the scoreboard, it messes with the chat size
              // console.table(this.scoreboard);
              // this.draw_border()
            })
          })
        },
        send: (message, type) => {
          if (!message || !type) return console.error('insufficent parameters')
      
          const full_message = {}
          full_message['type'] = type
          full_message['data'] = { ...message }
      
          this.client.socket.write(JSON.stringify(full_message) + DELIMITER)
        },
        join: () => {
          this.state = 'ingame'
          this.client.send({}, 'join')
          this.clear_chat()
          //give keyboard control to the player
          process.stdin.removeAllListeners('keypress')
          process.stdin.on('keypress', (str, key) => {
            if (key.ctrl && key.name === 'c') {
              process.exit(0);
            }
            else if (this.state === 'inchat') {
              rl.write(key.sequence.replace(/\x1B\[A|\x1B\[B/g, ''))
              readline.clearLine(process.stdout, 1);
            }
            else {
              //#region key bindings
              switch (key.name) {
                case 'w':
                  this.client.send({direction: 'N', action: 'move'}, 'move')
                  break;    
                case 's':
                  this.client.send({direction: 'S', action: 'move'}, 'move')
                  break;
                case 'a':
                  this.client.send({direction: 'W', action: 'move'}, 'move')
                  break;
                case 'd':
                  this.client.send({direction: 'E', action: 'move'}, 'move')
                  break;
                case 'up':
                  this.client.send({direction: 'N', action: 'attack'}, 'move')
                  break;
                case 'down':
                  this.client.send({direction: 'S', action: 'attack'}, 'move')
                  break;
                case 'left':
                  this.client.send({direction: 'W', action: 'attack'}, 'move')
                  break;
                case 'right':
                  this.client.send({direction: 'E', action: 'attack'}, 'move')
                  break;
                case 'e':
                  display.log_ip()
                  break;
                case 'c':
                  this.client.send({}, 'map')
                  break;
                case 'return':
                  //let the user write something
                  this.state = 'inchat'
                  //when he finished
                  rl.question('> ', (message) => {
                    this.state = 'ingame';
                    //clean up
                    readline.moveCursor(process.stdout, 0, -1);
                    readline.clearLine(process.stdout, 1);
                    if (message.trim() === '') return
                    //send the message
                    this.client.send({message}, 'chat'); 
                  })                
                  break
                default:
                  process.stdout.write(`Button ${key.name} unknown.             \r`)
                  break;
              }
            }
          });
        },
        close: (reason) => {
          if (this.client.socket) {
            //this true will not trigger a 'server closed'
            this.client.socket.destroy(reason)
            this.client.socket = null
          }
        },
      }
      /**
       * colors for the terminal
       * also encodings for spcefific characters:
       * @Z - zombie
       * @ ground
       * @hashtag wall
       * @d damaged modifier
       * @f finisher modifier
       * 
       */
      this.COLORS = {
        reset: '\x1b[0m',
        message: '\x1b[38;5;45m',
        placeholder: '\x1b[38;5;244m',
        pure_white: '\x1b[38;5;255m',
        error: '\x1b[38;5;9m',
        'Z': '\x1b[48;5;34mZ',
        ' ': '\x1b[48;5;0m ',
        '#': '\x1b[48;5;15m\x1b[38;5;250m#',
  
        'dZ': '\x1b[38;5;196m\x1b[48;5;34mZ', 
        'd ': '\x1b[38;5;196m/',
        'd#': '\x1b[48;5;15m\x1b[38;5;253m#',
  
        'fZ': '\x1b[38;5;196m\x1b[48;5;34mX',
  
        'd': '\x1b[38;5;196m~',
        'f': '\x1b[38;5;196m0',
      };
    }  
    //#region menu options
    async menu(type) {
      const options = this.current_options
      const selected_option = this.current_index
      //inside the options are values of previous screen
      switch(type) {
        case 'main':
          //reset any ongoing clients and servers
          this.client.close()
          this.stop_server()
          this.player_multicast?.close()

          this.menu_title = '|| Main Menu ||'
          this.current_options = [
            {id: 'play', name: 'Play'},
            {id: 'play_online', name: 'Play online'},
            {id: 'settings', name: 'Settings'},
            {id: 'quit', name: 'Nevermind'},
          ],
  
          this.show(0)
        break;
        case 'play_online':
          this.menu_title = '|| Play with friends ||'
          this.current_options = [
            {id: 'play_remote', name: 'Join game via IP', type: 'select', input: true, placeholder: 'XXX.XXX.X.X'},
            {id: 'main', name: 'Return to menu'},
          ]
  
          //start to look for available servers
          this.player_multicast = new Multicast('client')
          this.player_multicast.listen(() => {
            this.player_multicast.broadcast('LFG')
          })
          this.player_multicast.on('message', (msg, rinfo) => {
            //if a server is found, display it as an option
            let server_found = { 
              id: 'play_remote', 
              name: `Join server at ${rinfo.address}`,
              value: rinfo.address,
            }
            this.current_options = [server_found, ...this.current_options]
            this.current_index = 0 
            this.show(0)
          });
          
          this.show(0)
          break;
        case 'settings':
          this.menu_title = '|| Settings ||'
          this.current_options = [
            {id: 'screen_size', name: 'Change screen size'},
            {id: 'main', name: 'Return to menu'},
          ]
          this.show(0)
          break;
        case 'screen_size':
          this.menu_title = '|| How much space do you have? ||'
          this.current_options = [
            //ids here have to match their respective values, like: this.screen_width
            {id: 'screen_width', name: 'Width', type: 'slider', value: this.screen_width},
            {id: 'screen_height', name: 'Height', type: 'slider', value: this.screen_height},
            {id: 'chat_height', name: 'Chat Height', type: 'slider', value: this.chat_height},
            {id: 'screen_reset', name: 'Reset to default'},
            {id: 'settings', name: 'Return to settings'},
            {id: 'main', name: 'Return to menu'},
          ]
          this.show(0, true)
          break;
        case 'server_close':
          this.menu_title = '|| The server closed ||'
          this.current_options = [
            {id: 'main', name: 'Return to menu'},
            {id: 'quit', name: 'Nevermind'},
          ],
          this.show(0)
          break;
        case 'death_screen':
          this.menu_title = '|| You died ||'
          this.current_options = [
            {id: 'play_again_remote', name: 'Reconnect'},
            {id: 'main', name: 'Return to menu'},
            {id: 'quit', name: 'Nevermind'},
          ]
          this.show(0)
          break;
        //#region menu selected
        //cases for when a button is clicked, that is not another menu
        case 'play':
          //reset the server address
          this.game_server_address = DEFAULT_GAME_SERVER_ADDRESS
          
          if (typeof server === 'function') {
            //start the server if it exists
            this.stop_server = server(this.client.connect);
          }
          break;
        case 'play_remote':
          //get the values from the options
          const address_to_connect = options[selected_option].value
          //check for legit host
          if (net.isIP(address_to_connect.trim()) < 1) {
            options[selected_option].error = 'Impossible host address' + selected_option
            this.show()
            break;
          }
          // notify that it is connecting
          options[selected_option].message = 'Connecting...'
          this.show()
  
          //start game but with a remote server
          this.game_server_address = address_to_connect
          this.client.connect()
          break    
        case 'play_again_remote':
          this.client.join()
          break
        case 'screen_reset':
          this.screen_width = DEFAULT_SCREEN_WIDTH
          this.screen_height = DEFAULT_SCREEN_HEIGHT
          this.chat_height = DEFAULT_CHAT_HEIGHT
          this.show(0, true)
          break;
        case 'quit':
          console.clear()
          console.log('bye')
          process.exit(0)
        case 'death':
          this.state = 'death_screen'
          this.intro('You died.', 'death_screen')
          break;
      }
    }
    /**
     * show the `this.current_options` which the user can select.
     * the `this.menu_title` is displayed as well.
     * 
     * `this.current_options` is an object array, each object is one option,
     * each option has the following properties:
     * - id: the id of the option, used for the switch case
     * - name: the name of the option, displayed to the user
     * - type: the type of the option, default is 'select'
     * - input: if the option is an input, default is false
     * - placeholder: the placeholder of the input, default is ''
     * - value: the value of the option, default is ''
     * - message: a message to display beneath the option, default is ''
     * - error: an error message to display beneath the option, default is ''
     * 
     * 
     * it clears the console so this function cannot be used in the middle of a game
     * @param {Number} index At which position the initial cursor should be. 
     * default is the previous `this.current_index` or if it is a new options screen 0.
     * @param {Boolean} screen_borders Show screenborders, used for settings
     */
    show(index, screen_borders=false) {
      const options = this.current_options
      const selected_index = index ?? this.current_options[this.current_index] ? this.current_index : 0
      console.clear()
      //if we need to show the screen borders
      if (screen_borders) this.draw_border() 
  
      console.log(TITLE);
      console.log(this.menu_title);
      console.log();
  
      //render each of the options
      options.forEach((option, index) => {
        //set defaults
        if (!option.type) option.type = 'select'
        if (option.input && !option.value) option.value = ''
  
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
        //render the options
        else {
          if (index === selected_index) {
            //highlight selected
            console.log(this.COLORS.pure_white + '> ' + option.name + this.COLORS.reset); 
          } else {
            //print the other option
            console.log(' ' + option.name);
          }
  
          //print stuff beneath an option
          if (index === selected_index && option.input) {
            //margin
            process.stdout.write('  ') 
            console.log(option.value || this.COLORS.placeholder + (option.placeholder || '') + this.COLORS.reset);
          }
          if (index === selected_index && option.type === 'slider') {
            //less margin for the symbols
            process.stdout.write(' ') 
            console.log(`${this.COLORS.pure_white}- ${this[options[selected_index].id]} +${this.COLORS.reset}`);
          }
          if (index === selected_index && option.message) {
            process.stdout.write('  ') 
            console.log(this.COLORS.message + option.message + this.COLORS.reset);
          }
          //should not show errors and messages at the same time
          else if (index === selected_index && option.error) {
            process.stdout.write('  ') 
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
            //cleanse its error
            options[selected_index].error = '' 
            this.current_index = selected_index+1
            this.show(selected_index+1, screen_borders)
          }
        }
        else if (key.name === 'up') {
          if (selected_index > 0) {
            //cleanse its error
            options[selected_index].error = '' 
            this.current_index = selected_index-1
            this.show(selected_index-1, screen_borders)
          }
        }
        else if (key.name === 'left') {
          //if it is a slider
          if (options[selected_index].type === 'slider') {
            // const new_value = Math.max(options[selected_index].value - 1, 1) //cannot go below 1
            // options[selected_index].value = new_value
            // this[options[selected_index].id] = new_value
            this[options[selected_index].id] = this[options[selected_index].id] - 1
            this.show(selected_index, screen_borders)
          }
        }
        else if (key.name === 'right') {
          //if it is a slider
          if (options[selected_index].type === 'slider') {
            // const new_value = options[selected_index].value + 1
            // options[selected_index].value = new_value
            this[options[selected_index].id] = this[options[selected_index].id] + 1
            this.show(selected_index, screen_borders)
          }
        }
        else if (key.name === 'return') {
          //only enter menu if it is a select
          if (options[selected_index].type === 'select') {
            process.stdin.removeAllListeners('keypress')
            //save the selected index
            this.current_index = selected_index 
            this.menu(options[selected_index].id)
          }
        }
        //on key press
        else {
          //if an input is currently focused
          if (options[selected_index].input) { 
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
                //save the keypress to its value
                options[selected_index].value += key.sequence; 
              }
            }
            //cleanse its error after changing value
            options[selected_index].error = ''
            //reload the screen on the same index
            this.show(selected_index, screen_borders)
          }
        }
      });
    }
    /**
     * Show a message in a cool way, after pressing a key, go to the next menu
     * @param {String} message 
     * @param {String} next_menu default is the main menu
     * @returns 
     */
    async intro(message, next_menu='main') {
      this.state = 'intro'
      let displayedString = []

      process.stdin.removeAllListeners('keypress')      
      process.stdin.on('keypress', (str, key) => {
        if (key.ctrl && key.name === 'c') {
          process.exit();
        } else {
          //skip the animation
          if (this.state === 'intro') return this.state = 'intro_skipped'
          //if already skipped, (pressed twice)
          //or if the animation is done clean up the colors
          process.stdout.write(this.COLORS.reset) 
          //and go to main menu
          this.menu(next_menu)
        }
      });
      for (let i = 0; i < message.length; i++) {
        //if the intro is skipped 
        if (this.state === 'intro_skipped') {
          //then show the full message
          console.clear();
          return process.stdout.write(this.COLORS.reset + message);
        }
        console.clear();
        displayedString.push(message[i])
        process.stdout.write(`\x1b[38;5;${Math.min(Math.max(255-message.length, 232)+Math.round(i/(message.length/23)), 255)}m${displayedString.join('')}`);
        //wait for a delay so it the intro always takes exactly 2 seconds, no matter how long the text is
        await new Promise(resolve => setTimeout(() => {resolve()}, 2000/message.length))
      }
      //when the intro finished without user input, treat it as skipped
      this.state = 'intro_skipped'
    }
    /**
     * log the ip of the server
     */
    log_ip() {
      console.log('Host: ', this.game_server_address)
    }
    /**
     * processes the input character
     * @example'Z' -> '\x1b[48;5;34mZ' (Z with a green background)
     * @param {String} char 
     * @returns {String} Character corresponding to the parameter
     */
    process_char(char='') {
      let text_to_display = '';
      let chars = char.split('')
      //if we have to display a player,
      //meaning the last letter contains a number,
      if (!isNaN(parseInt(chars[chars.length-1]))) {
        const player_number = parseInt(chars[chars.length-1])
        //then give it a new color based on the number
        text_to_display += `\x1b[48;5;${player_number + 7}m`
  
        //and if the first letter is a registered modifier, for example when attacked
        if (this.COLORS[chars[0]] !== undefined) {
          //then apply that modified style
          text_to_display += this.COLORS[chars[0]]
        } else {
          //if it isn't a modifier, then just display the player wihtout any symbols
          text_to_display += ' ' 
        }
      } else {
        //if it is not a player, then give it its predefined color
        text_to_display = this.COLORS[char]
      }
      return text_to_display  
    }
    /**
     * renders the health of the player
     * @param {Number} amount
     * @returns {String} a bunch of ♥'s
     */ 
    render_health(amount) {
      let health = ''
      for (let i = 0; i < amount; i++) {
        health += '♥ '
      }
      return health + '                                        '
    }
    /**
     * prints the the processed map from raw data
     * @param {Array} map 2D array of the map
     * @returns
     */
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
    /**
     * changes one or more pixels on the screen depending on the data
     * @param {Array} data Ojbect array containing an `x` and `y` coordinate and `what` to change
     * @returns 
     */
    update(data) {
      //update should also handle log events but it cant right now
      if (!data) return console.error('No data to update')
      //for performance, move the cursor to the pixels to change and change them manually.
      data.forEach((change) => {
        for (let k = 0; k < TILE_SIZE; k++) {
          //move the cursor to the pixel location
          //k is the amount of rows
          readline.cursorTo(
            process.stdout, 
            change.x * (TILE_SIZE + 1),
            change.y * TILE_SIZE + k
          );
          
          process.stdout.write(this.process_char(change.what).repeat(TILE_SIZE + 1))
        }
      })
      process.stdout.write(this.COLORS.reset)
    }
    /**
     * draws border around the screen
     * depending on `this.screen_width` and `this.screen_height` and `this.chat_height`
     */
    draw_border() {
      //function that draws the bottom and right border of the screen
      const width = this.screen_width
      const height = this.screen_height
      const chat_height = this.chat_height
      const char = '#'
      // const char = '#'.repeat(tile_size)
  
      // Escape sequences to move the cursor
      const ESC = '\x1b';
      const moveCursor = (row, col) => `${ESC}[${row};${col}H`;
      
      // Draw the right border
      for (let row = 1; row <= height+chat_height; row++) {
          process.stdout.write(moveCursor(row, width) + char);
      }
  
      // Draw the bottom border
      process.stdout.write(moveCursor(height, 1) + char.repeat(width));
  
      // Draw the chat border
      process.stdout.write(moveCursor(height+chat_height, 1) + char.repeat(width));
      
      //reset the cursor to the top left
      process.stdout.write('\x1b[1;1H')
    }
  }
  
  const display = new Display()
  display.intro(`${TITLE}\nMade by ArcadeFortune\n`, 'main')
}


if (process.argv.length >= 3) {
  server()
} else {
  client()
}
