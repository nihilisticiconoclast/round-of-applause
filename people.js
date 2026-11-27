/*
 * Round of Applause: who's on the wheel.
 *
 * These are sample names and messages. Replace them with your own; the wheel
 * redraws itself to fit anywhere from 2 to 40 people. This is the list
 * everyone sees. The Edit tab on the page changes it in one browser only.
 *
 * Each person needs a name and a message. Optional per person:
 *   from:   overrides the sign-off for that card, e.g. 'From the data team'
 *   colour: a hex colour for their wedge and card, e.g. '#ff4f8b'
 */
window.ROUND_OF_APPLAUSE = {
  // Shown at the foot of every card unless a person has their own `from`.
  signOff: 'From all of us',

  // Nobody is ever picked twice in a row. Set this to true to go further:
  // everyone gets their round of applause before anyone comes up again.
  // (It can also be switched on and off from the Line-up panel.)
  everyoneOncePerRound: false,

  people: [
    {
      name: 'Priya',
      message: 'For turning the quarter-end numbers round in two days flat, and still finding time to check everyone else’s working.'
    },
    {
      name: 'Tom',
      message: 'For being the calm voice on every incident call. When something breaks, you’re the one we want on the line.'
    },
    {
      name: 'Aisha',
      message: 'For mentoring both new starters this quarter. They’re flying, and that’s down to you.'
    },
    {
      name: 'Alessandro',
      message: 'For rebuilding the dashboard nobody wanted to touch. It loads in seconds now, and people actually use it.'
    },
    {
      name: 'Sofia',
      message: 'For asking the awkward question in planning. It saved us a month of building the wrong thing.'
    },
    {
      name: 'Ben',
      message: 'For the cake rota, the leaving cards and every small kindness that makes this a good place to work.'
    },
    {
      name: 'Mei',
      message: 'For writing it all down as you go. Future us will be grateful, and present us already is.'
    },
    {
      name: 'Kwame',
      message: 'For stepping in to run the client workshop at a day’s notice, and absolutely nailing it.'
    },
    {
      name: 'Elena',
      message: 'For untangling the pipeline at seven in the morning so the board pack went out on time.'
    },
    {
      name: 'Josh',
      message: 'For the demo at the all-hands. Three other teams have already asked to borrow your approach.'
    },
    {
      name: 'Hannah',
      message: 'For covering two roles while we were short-staffed, without once letting it show.'
    },
    {
      name: 'Ravi',
      message: 'For code reviews that teach rather than tell. Everyone’s work is better for them.'
    }
  ]
};
