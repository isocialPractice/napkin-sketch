# Animation Physics

Physics-based animation uses real-world physical law - Newtonian mechanics solved by numerical
integration - to move objects, cloth, and fluids without anyone posing them. napkin-sketch does
none of that: it has no solver, no time step, and no forces. Every frame here is posed by hand,
one rigid transform per assembly.

Physics still decides whether those poses read as real. A solver spends its effort computing
*where a thing would be*; a frame-by-frame animator already chooses where it is, and uses physics
to choose **how far apart** consecutive frames sit. That is the whole translation, and the rest of
this file falls out of it.

## Core Physical Principles

### Newton's Laws

The first law governs constant velocity: absent a force, a thing keeps going at the same speed in
the same direction. On a frame sheet that is *even spacing* - equal gaps between frames.

The second law, `F = ma`, computes acceleration from applied force. Gravity and wind are the two
that matter for a sketch. Acceleration is not a position or a speed; it is a **change in spacing**
from one frame to the next.

The third law pairs every force with an equal and opposite one, which is why a figure pushing off
the ground rises, and why an impact throws debris back along the line it came in on.

### Weight and Momentum

Momentum is `p = mv`. A heavy object resists a change in motion more than a light one, so weight
shows up in animation as **how many frames a change takes**, not how far it goes:

- Heavy: many frames to get moving, many to stop, wide turns, little overshoot.
- Light: one or two frames to reach speed, stops almost immediately, sharp turns, visible
  overshoot and flutter.

Two objects can travel the same distance and read as completely different weights purely from the
number of frames spent accelerating.

### Energy Conservation

An impact transfers kinetic energy, and it has to go somewhere. An elastic object returns it as
rebound; an inelastic one spends it on sound, heat, and deformation - which on a sketch means
squash, debris, or a cloud. `breaking-objects.svg` draws both halves of that: a box giving up its
energy as separated pieces, and an impact cloud dispersing it.

## Spacing Is the Only Dial

With frames posed rather than solved, everything above reduces to spacing between consecutive
frames:

| What it looks like | What it means |
|--------------------|---------------|
| even gaps | constant velocity, no net force |
| gaps growing | accelerating - falling, being pushed, speeding up |
| gaps shrinking | decelerating - drag, braking, approaching an apex |
| gaps bunched | slow, or a held beat |
| one huge gap | an impact, a cut, or a frame missing from the sequence |

A sequence whose spacing contradicts its subject reads as wrong even when every pose in it is
drawn correctly.

## Gravity by the Odd-Number Rule

Under constant acceleration from rest, distance travelled grows with the square of elapsed time,
so the distance covered *during* each successive equal-length frame grows by the odd numbers. The
step from frame `n-1` to frame `n` covers `2n - 1` units:

| frame | 0 | 1 | 2 | 3 | 4 | 5 |
|-------|---|---|---|---|---|---|
| gap from the frame before | - | 1 | 3 | 5 | 7 | 9 |
| distance fallen so far | 0 | 1 | 4 | 9 | 16 | 25 |

This is the single most useful number in the file. To drop something over five frames, place it at
1, 4, 9, 16, and 25 units below where it started - not at 5, 10, 15, 20, 25. Reverse the same
series for anything thrown upward.

Where a cycle expresses movement as a percentage of the figure's height, the series scales the
same way: take the total drop, divide it by 25, and step by that unit.

## Arcs and the Apex

Horizontal speed is unaffected by gravity, so a thrown or jumping subject keeps **even horizontal
spacing** while its vertical spacing follows the odd-number series. Those two together are what
makes the path a parabola rather than a triangle. `bouncing-object.svg` draws the arc explicitly
as `object-path` for exactly this reason.

At the top of the arc vertical speed passes through zero, so frames bunch there. That bunching is
"hang time": a jump with evenly spaced frames throughout looks weightless, and one with two or
three frames clustered at the apex reads as a real jump. Nothing is added to the pose - only the
spacing changes.

## Bounce and Restitution

A bounce keeps a fixed fraction of its speed, the coefficient of restitution `e`. Height goes with
the square of speed, so each bounce reaches:

```text
h(next) = e^2 * h(previous)
```

A rubber ball at `e = 0.8` returns to about 64 percent of its height, then 41, then 26. A sketched
object usually reads well between 0.5 and 0.7 - noticeably lower each time, but not dead on the
second contact. Each successive arc is also *shorter in time*, so it needs fewer frames than the
one before; holding the frame count constant per bounce is the usual mistake.

## Simulation and Implementation

None of this section is used to draw a napkin-sketch frame. It is here so that a request asking
for simulation gets an accurate answer about what that would involve.

### Mass-Spring Systems

Points carrying mass, joined by springs with a stiffness and a damping term. Simple, versatile,
and easy to implement, which is why they are the usual entry point to physics-based animation,
and what cloth and soft bodies are typically built from.

### Numerical Integration

Analytical solutions are unavailable for most interesting systems, so the continuous equations are
replaced by difference equations over a discrete time step, using the finite difference
approximation:

```text
df(t)/dt  ~=  (f(t + dt) - f(t)) / dt
```

- **Explicit (forward Euler)**: the next state is computed from the current one alone. Cheap,
  simple, and unstable - it gains energy and diverges at large time steps.
- **Semi-implicit (symplectic Euler)**: velocity is updated first and the new velocity moves the
  position. Barely more expensive, far better behaved, and the usual default.
- **Implicit (backward Euler)**: mixes future and current values, so a system of equations has to
  be solved each step. Much more expensive, much more stable, and it tolerates large time steps.

### Advanced Dynamics

Rigid-body solvers, cloth, and fluids each need their own algorithms - collision detection and
response, constraint solving, pressure projection - for motion that keyframing cannot practically
reproduce. The cost is control: a simulation is directed by tuning parameters rather than by
drawing, which is why hand animation still wins wherever the movement is meant to say something
specific.

## Why This Skill Poses Rather Than Solves

Classical animation carried no physics tools at all; how a character moved was decided entirely by
the person animating it, with artistic intention above accuracy. Physics-assisted tools add weight
and inertia convincingly, but a ragdoll cannot be told what to express, and there is still no
single tool that does both well.

That is the position napkin-sketch takes deliberately. The rigs supply measured joint angles for
the animations that have skeletons; physics supplies the spacing between frames for everything
else. Neither is a solver, and a request for real simulation is a request for a different kind of
program.

## Sources

- [Intro to Graphics 24 - Physics Based Animation](https://www.youtube.com/watch?v=F9TP48yXs3s):
  mass-spring systems as the entry point to physics-based animation
- [Physics-Based Animation](https://www.tutorialspoint.com/computer_graphics/computer_graphics_physics_based_animation.htm):
  the finite difference method, explicit against implicit schemes, and the application domains
- [Weight and energy on impact](https://www.youtube.com/watch?v=kj1kaA_8Fu4): energy transfer,
  elastic against inelastic response
- [Physics in Animation](https://cascadeur.com/blog/general/physics-in-animation): centre of mass,
  angular momentum, and why artistic intention still leads the tooling
