# Robot Arm Digital Twin in MATLAB

This project is a CV-ready MATLAB simulation project for a 6-DOF robot arm.
It demonstrates inverse kinematics, pick-and-place trajectory planning,
collision checking, and simulation result visualization.

## What the project does

- Builds a generic 6-DOF serial robot using `rigidBodyTree`
- Defines a pick-and-place task with Cartesian waypoints
- Solves inverse kinematics for all target poses
- Generates smooth joint-space trajectories with `trapveltraj`
- Checks self-collision and environment collision
- Plots joint position, velocity, acceleration, and obstacle clearance
- Animates the robot, table, obstacle, pick object, and place location

## Requirements

- MATLAB
- Robotics System Toolbox

Recommended later extensions:

- Simscape Multibody for a richer multibody/CAD digital twin
- Simulink for closed-loop control
- Model Predictive Control Toolbox for MPC-based motion/control experiments

## How to run

Open MATLAB in this folder and run:

```matlab
startup
main
```

The script saves `results/simulation_results.mat` after a run.

## Suggested CV description

> Developed a MATLAB-based robot arm digital twin for a pick-and-place task,
> including rigid-body modeling, inverse kinematics, joint-space trajectory
> generation, collision checking, and automated simulation result analysis.

## Extension roadmap

1. Add a gripper state machine: open, approach, close, lift, place, release.
2. Add joint torque analysis with inverse dynamics.
3. Add PID joint controllers in Simulink.
4. Replace the generic robot with a URDF/CAD model.
5. Import the model into Simscape Multibody and compare kinematic results.
6. Add trajectory optimization that minimizes time, jerk, and collision risk.
7. Export an animation or GIF for GitHub and LinkedIn.

## Project structure

```text
robot_arm_digital_twin/
  main.m
  startup.m
  src/
    createDemoRobot.m
    createEnvironment.m
    makePickPlaceWaypoints.m
    solveWaypointIK.m
    planJointTrajectory.m
    checkTrajectoryCollisions.m
    plotJointProfiles.m
    plotClearance.m
    animateTrajectory.m
  results/
  docs/
```
